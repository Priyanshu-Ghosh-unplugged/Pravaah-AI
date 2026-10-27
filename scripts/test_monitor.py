import urllib.request, json, time

for i in range(8):
    try:
        res = json.loads(urllib.request.urlopen('http://localhost:8000/api/v1/health').read())
        fsm = res['snapshot']['fsm']
        vis = res['snapshot']['vision']
        pcu_str = ', '.join([f"{k}:{vis[k]['effective_pcu']}" for k in ['NORTH','EAST','SOUTH','WEST']])
        print(f"T={i*1.0:.1f}s | State={fsm['phase_state']} | Active={fsm['active_approach']} | Rem={fsm['remaining_sec']}s | Lights={fsm['lights']} | PCUs: {pcu_str}", flush=True)
    except Exception as e:
        print("Error:", e, flush=True)
    time.sleep(1.0)
