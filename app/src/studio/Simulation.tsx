import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Play, Square, Plug } from "lucide-react";
import { buildTimeline, findRobot, fromBrowserGamepad, robotStreamUrl, StreamClient, type ConnectionStatus, type GamepadStateMessage, type PoseMessage, type Program, type Project, type ServerMessage, type OpModeInfo, type Phase } from "../core";
import { isDesktop } from "../desktop/backend";
import type { DesktopSimulator } from "../desktop/robotProject";
import { Field } from "./FieldEditor";
import { RunComparison } from "./RunComparison";
import { RunRecorder, isRunTimingKey, saveRunTiming } from "./runTimings";

type Hello=Extract<ServerMessage,{type:"hello"}>;
const PHASES:Phase[]=["idle","init","running","stopped"],FOLLOWER=new Map([["follow","Following a path"],["hold","Holding position"],["manual","Manual drive"],["idle","Idle"]]);
/** Frames come from the network, so values are checked before they are drawn or formatted. */
const finite=(p?:PoseMessage)=>p&&[p.x,p.y,p.heading].every(Number.isFinite)?p:undefined,show=(value:unknown)=>typeof value==="string"?value:JSON.stringify(value)??String(value),degrees=(heading:number)=>(heading*180/Math.PI).toFixed(1);

export function Simulation({project,program,launch,busy,cancel,onLog,robot=false,host="192.168.43.1",simulatorSetup,canLaunch=true}:{project:Project;program:Program;launch:()=>Promise<DesktopSimulator|undefined>;busy:string;cancel:()=>void;onLog:(s:string)=>void;robot?:boolean;host?:string;simulatorSetup?:ReactNode;canLaunch?:boolean}){
 const [connection,setConnection]=useState<ConnectionStatus>("closed"),[linked,setLinked]=useState(false),[opened,setOpened]=useState(false),[finding,setFinding]=useState(false),[phase,setPhase]=useState<Phase>("idle"),[active,setActive]=useState<string|null>(null),[modes,setModes]=useState<OpModeInfo[]>([]),[mode,setMode]=useState(""),[pose,setPose]=useState<PoseMessage>(),[target,setTarget]=useState<PoseMessage>(),[route,setRoute]=useState<[number,number][]>(),[telemetry,setTelemetry]=useState<string[]>([]),[data,setData]=useState<Record<string,unknown>>({}),[loop,setLoop]=useState<number>(),[follower,setFollower]=useState<string>(),[hello,setHello]=useState<Hello>(),[elapsed,setElapsed]=useState(0),[playing,setPlaying]=useState(false),[limit,setLimit]=useState(30),[keyboard,setKeyboard]=useState(false);
 // `linked` is true while a StreamClient exists, including while it reconnects; `opened` is whether that client has connected yet.
 const client=useRef<StreamClient|null>(null),sim=useRef<DesktopSimulator|null>(null),alive=useRef(true),starting=useRef(false),epoch=useRef(0),runStart=useRef<number|null>(null),source=useRef<Hello["source"]>(robot?"robot":"simulator"),keys=useRef(new Set<string>()),screen=useRef<GamepadStateMessage>({});
 const preview=!robot&&!isDesktop();const timeline=useMemo(()=>program.kind==="autonomous"?buildTimeline(program,project):null,[program,project]);
 /** Drops the client; for the simulator it also presses STOP, shuts the simulator down, and cancels its task. */
 const release=()=>{const stream=client.current,running=sim.current;client.current=null;sim.current=null;runStart.current=null;epoch.current++;if(!robot){stream?.stop();stream?.shutdown();void running?.task.cancel().catch(()=>{});}stream?.close();};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(starting.current)cancel();release();};},[]);
 useEffect(()=>{if(!playing||!timeline)return;let last=performance.now();const timer=setInterval(()=>{const now=performance.now(),delta=now-last;last=now;setElapsed(t=>{const next=Math.min(t+delta,timeline.durationMs);if(next>=timeline.durationMs)setPlaying(false);return next;});},30);return()=>clearInterval(timer);},[playing,timeline]);
 /** What one OpMode run reported; cleared at INIT. */
 const clearRun=()=>{setRoute(undefined);setTarget(undefined);setData({});setLoop(undefined);setFollower(undefined);};
 const clearStream=()=>{
  runStart.current=null;
  setHello(undefined);setModes([]);setMode("");setActive(null);setPhase("idle");
  setElapsed(0);setPose(undefined);setTelemetry([]);clearRun();
 };
 const disconnect=()=>{release();setLinked(false);setConnection("closed");clearStream();};
 /** A hub sends no elapsed time, so robot mode times the run itself: from START, frozen at STOP, reset at the next INIT. */
 const time=(next:Phase)=>{const now=performance.now();if(next==="running"){if(runStart.current===null){runStart.current=now;setElapsed(0);}return;}if(next==="stopped"&&runStart.current!==null)setElapsed(now-runStart.current);if(next==="init"||next==="idle")setElapsed(0);runStart.current=null;};
 const receive=(m:ServerMessage)=>{
  if(m.type==="hello"){setHello(m);source.current=m.source==="simulator"?"simulator":"robot";}
  else if(m.type==="manifest"){const list=Array.isArray(m.opModes)?m.opModes.filter(o=>o&&typeof o.name==="string"&&typeof o.flavor==="string"):[];setModes(list);setMode(v=>list.some(o=>o.name===v)?v:list.find(o=>o.name===program.name)?.name??list[0]?.name??"");}
  else if(m.type==="lifecycle"&&PHASES.includes(m.phase)){setPhase(m.phase);setActive(typeof m.opMode==="string"?m.opMode:null);if(typeof m.opMode==="string"&&m.phase!=="stopped")setMode(m.opMode);if(m.phase==="init"){clearRun();setTelemetry([]);if(robot)setPose(undefined);}if(robot)time(m.phase);}
  // The simulator's `robot` pose is the true pose; `state.pose` is the follower's estimate, drawn only for a hub.
  else if(m.type==="robot"){const p=finite(m.pose);if(p)setPose(p);if(Number.isFinite(m.elapsed))setElapsed(m.elapsed*1000);if(PHASES.includes(m.phase))setPhase(m.phase);}
  else if(m.type==="state"){const p=finite(m.pose),values=m.data;if(p&&source.current==="robot")setPose(p);setTarget(finite(m.target));setLoop(Number.isFinite(m.loopMs)?m.loopMs:undefined);setFollower(typeof m.follower==="string"?m.follower:undefined);if(values&&typeof values==="object"&&!Array.isArray(values))setData(d=>({...d,...values}));}
  else if(m.type==="path")setRoute(Array.isArray(m.points)?m.points.filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])):undefined);
  else if(m.type==="telemetry")setTelemetry(Array.isArray(m.lines)?m.lines.map(String):[]);
  else if(m.type==="error")onLog(m.message);
 };
 /** Replaces any existing client, so one view never holds two connections. Events from a replaced client are ignored. */
 const connect=(url:string,token?:string)=>{
  const previous=client.current;
  const stream=new StreamClient({url,token});
  const recorder=new RunRecorder(robot?"robot":"simulator");
  client.current=stream;previous?.close();epoch.current++;
  source.current=robot?"robot":"simulator";
  setLinked(true);setOpened(false);clearStream();
  stream.onStatus(status=>{
   if(client.current!==stream)return;
   setConnection(status);
   if(status==="open")setOpened(true);
   if(status==="closed"){recorder.reset();clearStream();}
  });
  stream.onMessage(message=>{
   if(client.current!==stream)return;
   const timing=recorder.receive(message,performance.now());
   if(timing)saveRunTiming(project.id,timing);
   receive(message);
  });
  stream.connect();
 };
 const find=async()=>{
  setFinding(true);
  const at=epoch.current;
  const found=await findRobot();
  if(!alive.current)return;
  setFinding(false);
  if(epoch.current!==at)return;
  if(found)connect(robotStreamUrl(found.host));
  else onLog("No robot found. Join robot Wi-Fi and try again.");
 };
 const open=async()=>{
  if(robot){connect(robotStreamUrl(host));return;}
  if(starting.current||!canLaunch)return;
  starting.current=true;
  const running=await launch().finally(()=>{starting.current=false;});
  if(!alive.current){void running?.task.cancel().catch(()=>{});return;}
  if(!running)return;
  sim.current=running;
  connect(running.url,running.token);
  void running.task.result.catch(error=>{if(sim.current===running)onLog(String(error));}).finally(()=>{
   if(sim.current!==running)return;
   const stream=client.current;
   client.current=null;sim.current=null;stream?.close();
   setLinked(false);setConnection("closed");setPhase("stopped");
  });
 };
 useEffect(()=>{if(!robot||phase!=="running")return;const timer=setInterval(()=>{if(runStart.current!==null)setElapsed(performance.now()-runStart.current);},100);return()=>clearInterval(timer);},[robot,phase]);
 useEffect(()=>{if(!robot&&phase==="running"&&elapsed>=limit*1000)client.current?.stop();},[elapsed,phase,limit,robot]);
 useEffect(()=>{if(robot||preview||connection!=="open")return;const down=(e:KeyboardEvent)=>{if(keyboard&&!/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName)&&["w","a","s","d","q","e","j","k","u","i"].includes(e.key.toLowerCase())){keys.current.add(e.key.toLowerCase());e.preventDefault();}};const up=(e:KeyboardEvent)=>keys.current.delete(e.key.toLowerCase());const blur=()=>{keys.current.clear();screen.current={};client.current?.gamepad(1,{left_stick_x:0,left_stick_y:0,right_stick_x:0,a:false,b:false,x:false,y:false});};window.addEventListener("keydown",down);window.addEventListener("keyup",up);window.addEventListener("blur",blur);const timer=setInterval(()=>{const pads=navigator.getGamepads?.()??[];const pad=Array.from(pads).find(p=>p?.mapping==="standard");const k=keys.current;client.current?.gamepad(1,pad?fromBrowserGamepad(pad):{left_stick_x:(k.has("d")?1:0)-(k.has("a")?1:0),left_stick_y:(k.has("s")?1:0)-(k.has("w")?1:0),right_stick_x:(k.has("e")?1:0)-(k.has("q")?1:0),a:k.has("j"),b:k.has("k"),x:k.has("u"),y:k.has("i"),...screen.current});},50);return()=>{clearInterval(timer);window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);window.removeEventListener("blur",blur);blur();};},[robot,preview,connection,keyboard]);
 const status=preview?"Offline":!linked?"Disconnected":connection==="open"?"Connected":opened?"Reconnecting…":"Connecting…",values=Object.entries(data).filter(([key])=>!isRunTimingKey(key));
 return <div className="simulation"><div className="simulation-field"><div className="inline-actions"><span className="chip">{preview?"Preview · ideal path motion":robot?"Robot · telemetry":"Real Java · simulated hardware"}</span><span role="status">{status}</span></div><Field program={program.kind==="autonomous"?program:undefined} pose={preview?timeline?.poseAt(elapsed):pose} followPath={preview?undefined:route} followTarget={preview?undefined:target}/>{preview?<><div className="inline-actions"><button className="primary" disabled={!timeline||!!timeline.error||timeline.durationMs===0} onClick={()=>{if(elapsed>=timeline!.durationMs)setElapsed(0);setPlaying(!playing);}}><Play/>{playing?"Pause":"Run preview"}</button><button onClick={()=>{setPlaying(false);setElapsed(0);}}><Square/>Reset</button><span>{(elapsed/1000).toFixed(1)} / {((timeline?.durationMs??0)/1000).toFixed(1)} s</span></div><input aria-label="Preview timeline" type="range" min="0" max={timeline?.durationMs??0} value={elapsed} onChange={e=>{setPlaying(false);setElapsed(Number(e.target.value));}}/>{timeline?.error&&<p role="alert">{timeline.error}</p>}<p>Estimates path motion only. The desktop app runs your Java, mechanisms, and gamepads.</p></>:<>{!robot&&simulatorSetup}<div className="inline-actions">{linked?<button onClick={disconnect}>Disconnect</button>:<button className="primary" disabled={!!busy||finding||(!robot&&!canLaunch)} onClick={()=>void open()}><Plug/>{robot?"Connect robot":"Launch simulator"}</button>}{!robot&&busy&&<button onClick={cancel}>Cancel startup</button>}{robot&&<button disabled={linked||finding} onClick={()=>void find()}>{finding?"Finding robot…":"Find robot"}</button>}</div>{robot?<p className="active-opmode" role="status">OpMode<strong>{active?`${active} · ${phase.toUpperCase()}`:"None reported"}</strong></p>:<label>OpMode<select value={mode} disabled={phase==="running"} onChange={e=>setMode(e.target.value)}><option value="">Choose an OpMode</option>{modes.map(m=><option key={m.name} value={m.name}>{m.name} · {m.flavor}</option>)}</select></label>}<div className="inline-actions">{!robot&&<><button disabled={connection!=="open"||!mode||phase==="running"} onClick={()=>client.current?.initOpMode(mode)}>INIT</button><button className="primary" disabled={connection!=="open"||phase!=="init"} onClick={()=>client.current?.start()}>START</button></>}<button className="danger" disabled={connection!=="open"} onClick={()=>client.current?.stop()}><Square/>STOP</button><span>{phase.toUpperCase()} · {(elapsed/1000).toFixed(1)} s</span></div>{!robot&&<><label>Match timer<select value={limit} onChange={e=>setLimit(Number(e.target.value))}><option value="30">Autonomous · 0:30</option><option value="120">TeleOp · 2:00</option></select></label><label className="check"><input type="checkbox" checked={keyboard} onChange={e=>{keys.current.clear();setKeyboard(e.target.checked);}}/>Keyboard gamepad: WASD, Q/E turn, J/K/U/I buttons</label><div className="inline-actions">{(["a","b","x","y"] as const).map(b=><button key={b} disabled={connection!=="open"} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);screen.current={...screen.current,[b]:true};}} onPointerUp={()=>{screen.current={...screen.current,[b]:false};}} onPointerCancel={()=>{screen.current={...screen.current,[b]:false};}}>{b.toUpperCase()}</button>)}</div><p>A standard USB gamepad takes priority when connected.</p></>}{robot&&<p>Start robot OpModes from the Driver Station. This connection reads telemetry and can request STOP.</p>}</>}</div>
 <aside className="properties"><RunComparison key={project.id} projectId={project.id} opModeName={program.name}/><h2>Telemetry</h2>{hello&&<p>{hello.source} · library {hello.library}{hello.drivetrain&&<><br/>{hello.drivetrain.localizer??"No localizer reported"}</>}</p>}{!robot&&<pre className="telemetry-lines">{telemetry.length?telemetry.join("\n"):"Waiting for telemetry…"}</pre>}{(robot||loop!==undefined)&&<dl className="stream-values"><div><dt>Loop time</dt><dd>{loop===undefined?"Not reported":`${loop.toFixed(1)} ms`}</dd></div><div><dt>Follower</dt><dd>{follower?FOLLOWER.get(follower)??follower:loop===undefined?"Not reported":"None attached"}</dd></div></dl>}{(robot||values.length>0)&&<><h3>Session data</h3>{values.length?<dl className="stream-values">{values.map(([name,value])=><div key={name}><dt>{name}</dt><dd>{show(value)}</dd></div>)}</dl>:<p>Values the OpMode reports with Session.data appear here.</p>}</>}{pose&&<p>X {pose.x.toFixed(2)} in<br/>Y {pose.y.toFixed(2)} in<br/>Heading {degrees(pose.heading)}°</p>}{target&&<p>Follower target<br/>X {target.x.toFixed(2)} in<br/>Y {target.y.toFixed(2)} in<br/>Heading {degrees(target.heading)}°</p>}</aside></div>;
}
