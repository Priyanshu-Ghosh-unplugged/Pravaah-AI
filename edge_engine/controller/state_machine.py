"""
Deterministic Safety-Interlocked Finite State Machine for Pravaah AI.
10 Hz controller enforcing IRC:93 intergreens, minimum/maximum clamps, and anti-starvation scheduling.
"""
from typing import Dict, List, Optional, Set
from edge_engine.controller.models import SignalLight, JunctionPhaseState, ApproachDemand
from edge_engine.controller.timing_math import (
    STARVATION_CAP_SEC,
    compute_dynamic_green_seconds,
    compute_priority_score,
    select_next_approach,
)

APPROACH_ORDER: List[str] = ["NORTH", "EAST", "SOUTH", "WEST"]


class AdaptiveJunctionStateMachine:
    """
    10 Hz Deterministic Traffic Signal Controller.
    Guarantees safety invariant: At most ONE approach is ever GREEN or AMBER at any instant.
    """

    def __init__(
        self,
        amber_sec: float = 3.0,
        all_red_sec: float = 2.0,
        min_green_sec: float = 10.0,
        max_green_sec: float = 60.0,
        gap_out_sec: float = 3.5,
        emergency_min_safe_green_sec: float = 6.0,
    ):
        self.amber_sec = amber_sec
        self.all_red_sec = all_red_sec
        self.min_green_sec = min_green_sec
        self.max_green_sec = max_green_sec
        self.gap_out_sec = gap_out_sec
        self.emergency_min_safe_green_sec = emergency_min_safe_green_sec

        self.phase_state: JunctionPhaseState = JunctionPhaseState.ALL_RED_IDLE
        self.active_approach: Optional[str] = None
        self.queued_next_approach: Optional[str] = None

        self.phase_elapsed_sec: float = 0.0
        self.allocated_green_sec: float = 0.0
        self.zero_queue_streak_sec: float = 0.0
        self.ped_bonus_granted_sec: float = 0.0

        self.wait_timers: Dict[str, float] = {app: 0.0 for app in APPROACH_ORDER}
        # Approaches already given their green in the current service cycle. Every occupied
        # approach is served once per cycle (ordered by priority) before any approach repeats.
        self.served_this_cycle: Set[str] = set()
        self.skipped_phases_count: int = 0
        self.emergency_preemptions_count: int = 0
        self.manual_override_target: Optional[str] = None

    def get_light_states(self) -> Dict[str, SignalLight]:
        lights = {app: SignalLight.RED for app in APPROACH_ORDER}
        if self.active_approach is not None:
            if self.phase_state == JunctionPhaseState.PHASE_GREEN:
                lights[self.active_approach] = SignalLight.GREEN
            elif self.phase_state == JunctionPhaseState.PHASE_AMBER:
                lights[self.active_approach] = SignalLight.AMBER
        # Safety invariant runtime assertion
        non_red = [app for app, col in lights.items() if col != SignalLight.RED]
        assert len(non_red) <= 1, f"CRITICAL SAFETY INVARIANT BREACH: {lights}"
        return lights

    def step(self, dt_sec: float, demands: Dict[str, ApproachDemand]) -> Dict[str, object]:
        """Advances controller by dt_sec (typically 0.1s) and returns telemetry snapshot."""
        # 1. Update red-light waiting clocks for occupied non-green approaches
        for app_id, dem in demands.items():
            is_green = (
                self.phase_state == JunctionPhaseState.PHASE_GREEN
                and self.active_approach == app_id
            )
            if is_green:
                self.wait_timers[app_id] = 0.0
            else:
                has_waiting = (
                    dem.effective_pcu > 0.0
                    or dem.pedestrians_waiting > 0
                    or dem.senior_ped_requested
                    or not dem.sensor_healthy
                )
                if has_waiting:
                    self.wait_timers[app_id] += dt_sec
                else:
                    self.wait_timers[app_id] = 0.0
            dem.wait_seconds = self.wait_timers[app_id]

        self.phase_elapsed_sec += dt_sec

        # 2. Check for Emergency Vehicle Preemption or Police Override
        emergency_apps = [app for app, d in demands.items() if d.emergency_active]
        urgent_target = (
            self.manual_override_target
            if self.manual_override_target
            else (emergency_apps[0] if emergency_apps else None)
        )

        # 3. State transition execution
        if self.phase_state == JunctionPhaseState.ALL_RED_IDLE:
            # Rest on all-red while the whole junction is empty; wake as soon as anything arrives
            next_app = urgent_target or self._select_in_cycle(demands)
            if next_app is not None:
                self._enter_green(next_app, demands)

        elif self.phase_state == JunctionPhaseState.PHASE_GREEN:
            assert self.active_approach is not None
            curr_dem = demands[self.active_approach]

            # Track continuous empty streak for Gap-Out optimization
            if curr_dem.effective_pcu == 0.0 and curr_dem.pedestrians_waiting == 0:
                self.zero_queue_streak_sec += dt_sec
            else:
                self.zero_queue_streak_sec = 0.0

            # Case A: Urgent preemption on a DIFFERENT approach
            if urgent_target and urgent_target != self.active_approach:
                if self.phase_elapsed_sec >= self.emergency_min_safe_green_sec:
                    self.queued_next_approach = urgent_target
                    self.emergency_preemptions_count += 1
                    self._enter_amber()

            # Case B: Emergency vehicle or override on CURRENT green approach
            elif urgent_target == self.active_approach:
                if self.phase_elapsed_sec >= 60.0:
                    # Safety auto-release override lock after 60s
                    self.manual_override_target = None
                    self._enter_amber()
                else:
                    self.allocated_green_sec = max(self.allocated_green_sec, self.phase_elapsed_sec + 5.0)

            # Case C: Normal dynamic operation (Pedestrian grace extension, Gap-out, or Timer expiry)
            else:
                remaining = self.allocated_green_sec - self.phase_elapsed_sec
                # Vulnerable pedestrian still inside crosswalk near end of walk phase
                if (
                    remaining <= 2.5
                    and curr_dem.pedestrians_waiting > 0
                    and self.ped_bonus_granted_sec < 10.0
                ):
                    self.allocated_green_sec += 2.0
                    self.ped_bonus_granted_sec += 2.0

                gap_out_ready = (
                    self.phase_elapsed_sec >= self.min_green_sec
                    and self.zero_queue_streak_sec >= self.gap_out_sec
                )
                time_expired = self.phase_elapsed_sec >= self.allocated_green_sec

                if gap_out_ready or time_expired:
                    other_waiting = self._select_in_cycle(demands, exclude=self.active_approach)
                    # If nobody else is waiting on any cross-street and current still has cars, renew smoothly
                    if other_waiting is None and curr_dem.effective_pcu > 0.0:
                        self.allocated_green_sec = compute_dynamic_green_seconds(curr_dem)
                        self.phase_elapsed_sec = 0.0
                    else:
                        # None here means the junction is empty: clear down and rest on all-red
                        self.queued_next_approach = other_waiting
                        self._enter_amber()

        elif self.phase_state == JunctionPhaseState.PHASE_AMBER:
            if self.phase_elapsed_sec >= self.amber_sec:
                self.phase_state = JunctionPhaseState.INTERGREEN_ALL_RED
                self.phase_elapsed_sec = 0.0

        elif self.phase_state == JunctionPhaseState.INTERGREEN_ALL_RED:
            if self.phase_elapsed_sec >= self.all_red_sec:
                # Re-evaluate at the end of the clearance interval so the decision uses the
                # freshest densities (the queued choice is only a fallback).
                chosen = (
                    urgent_target
                    or self._select_in_cycle(demands)
                    or self.queued_next_approach
                )
                if chosen is None:
                    self.phase_state = JunctionPhaseState.ALL_RED_IDLE
                    self.phase_elapsed_sec = 0.0
                else:
                    if self.active_approach in APPROACH_ORDER:
                        idx = APPROACH_ORDER.index(self.active_approach)
                        for offset in range(1, 4):
                            cand = APPROACH_ORDER[(idx + offset) % 4]
                            if cand == chosen:
                                break
                            if compute_dynamic_green_seconds(demands[cand]) == 0:
                                self.skipped_phases_count += 1
                    self._enter_green(chosen, demands)

        return {
            "phase_state": self.phase_state.value,
            "active_approach": self.active_approach,
            "next_approach": self._predict_next(demands, urgent_target),
            "lights": {k: v.value for k, v in self.get_light_states().items()},
            "remaining_sec": round(max(0.0, self._target_duration() - self.phase_elapsed_sec), 1),
            "allocated_green_sec": self.allocated_green_sec,
            "wait_timers": {k: round(v, 1) for k, v in self.wait_timers.items()},
            "priority_scores": {k: compute_priority_score(d) for k, d in demands.items()},
            "cycle_served": [app for app in APPROACH_ORDER if app in self.served_this_cycle],
            "skipped_phases_count": self.skipped_phases_count,
            "emergency_preemptions_count": self.emergency_preemptions_count,
        }

    def _select_in_cycle(
        self, demands: Dict[str, ApproachDemand], exclude: Optional[str] = None
    ) -> Optional[str]:
        """
        Picks the next approach to serve. Approaches not yet served this cycle go first, ordered
        by priority (PCU density + wait aging); a starving approach may always jump the queue.
        Once every occupied approach has had its turn, a fresh cycle is opened.
        """
        candidates = {k: v for k, v in demands.items() if k != exclude}
        pending = {
            k: v
            for k, v in candidates.items()
            if k not in self.served_this_cycle or v.wait_seconds >= STARVATION_CAP_SEC
        }
        choice = select_next_approach(pending, self.active_approach) if pending else None
        if choice is None:
            choice = select_next_approach(candidates, self.active_approach)
        return choice

    def _predict_next(
        self, demands: Dict[str, ApproachDemand], urgent_target: Optional[str]
    ) -> Optional[str]:
        if urgent_target and urgent_target != self.active_approach:
            return urgent_target
        if self.phase_state == JunctionPhaseState.PHASE_GREEN:
            return self._select_in_cycle(demands, exclude=self.active_approach)
        return self._select_in_cycle(demands)

    def _target_duration(self) -> float:
        if self.phase_state == JunctionPhaseState.PHASE_GREEN:
            return self.allocated_green_sec
        if self.phase_state == JunctionPhaseState.PHASE_AMBER:
            return self.amber_sec
        if self.phase_state == JunctionPhaseState.INTERGREEN_ALL_RED:
            return self.all_red_sec
        return 0.0

    def _enter_green(self, approach_id: str, demands: Dict[str, ApproachDemand]) -> None:
        demand = demands[approach_id]
        others_pending = any(
            app != approach_id
            and app not in self.served_this_cycle
            and compute_priority_score(d) >= 0.0
            for app, d in demands.items()
        )
        if approach_id in self.served_this_cycle and not others_pending:
            self.served_this_cycle = set()  # Cycle complete: everybody waiting has been served
        self.served_this_cycle.add(approach_id)

        self.active_approach = approach_id
        self.phase_state = JunctionPhaseState.PHASE_GREEN
        self.phase_elapsed_sec = 0.0
        self.zero_queue_streak_sec = 0.0
        self.ped_bonus_granted_sec = 0.0
        self.queued_next_approach = None  # Clear queued target once entered
        self.allocated_green_sec = float(max(10, compute_dynamic_green_seconds(demand)))
        demand.senior_ped_requested = False

    def _enter_amber(self) -> None:
        self.phase_state = JunctionPhaseState.PHASE_AMBER
        self.phase_elapsed_sec = 0.0
