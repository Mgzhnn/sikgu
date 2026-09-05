/** A single, cancellable request chain shared by feed and chat polling.
 * @param {{run:(signal:AbortSignal)=>Promise<unknown>,base:number,hidden:()=>boolean,
 * subscribe:(wake:()=>void)=>()=>void,setTimer:(task:()=>void,delay:number)=>number,clearTimer:(id:number)=>void}} options
 */
export function startPolling({run,base,hidden,subscribe,setTimer,clearTimer}) {
  let stopped=false, failures=0, timer=0, running=false, wakePending=false;
  const controller=new AbortController();
  const schedule=()=>{
    clearTimer(timer);
    if(!stopped)timer=setTimer(()=>void tick(),Math.min(base*2**failures,300000));
  };
  const tick=async()=>{
    if(stopped)return;
    if(running){wakePending=true;return;}
    clearTimer(timer);
    running=true;
    try {
      if(!hidden()) {
        const result=await run(controller.signal);
        if(result!==null)failures=result===false?failures+1:0;
      }
    } catch { if(!stopped)failures++; }
    finally {
      running=false;
      if(!stopped){
        if(wakePending){wakePending=false;void tick();}else schedule();
      }
    }
  };
  const unsubscribe=subscribe(()=>{
    if(stopped||hidden())return;
    failures=0;
    void tick();
  });
  schedule();
  return ()=>{stopped=true;controller.abort();clearTimer(timer);unsubscribe();};
}
