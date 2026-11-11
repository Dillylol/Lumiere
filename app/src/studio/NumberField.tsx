import { useState } from "react";

/**
 * A number input that only ever passes valid values on. While typing, values inside `min`–`max`
 * (and whole numbers when `integer`) go straight to `onChange`; anything else waits, marked invalid,
 * and is clamped when the field loses focus or Enter is pressed. A project therefore never holds a
 * value its schema would refuse to save.
 */
export function NumberField({label,value,onChange,min,max,step=1,integer=false,hideLabel=false}:{label:string;value:number;onChange:(n:number)=>void;min?:number;max?:number;step?:number;integer?:boolean;
 /** Keeps the label for screen readers only, as in a table whose column heading already says it. */
 hideLabel?:boolean}){
 const [draft,setDraft]=useState<string>();
 const valid=(n:number)=>Number.isFinite(n)&&(min===undefined||n>=min)&&(max===undefined||n<=max)&&(!integer||Number.isInteger(n));
 const clamp=(n:number)=>{const whole=integer?Math.round(n):n;return Math.min(max??Infinity,Math.max(min??-Infinity,whole));};
 const commit=()=>{if(draft===undefined)return;const n=Number(draft);if(draft.trim()!==""&&Number.isFinite(n)){const next=clamp(n);if(next!==value)onChange(next);}setDraft(undefined);};
 const invalid=draft!==undefined&&!valid(Number(draft.trim()===""?NaN:draft));
 return <label className={hideLabel?"hidden-label":undefined}>{hideLabel?<span className="sr-only">{label}</span>:label}<input type="number" value={draft??(Number.isFinite(value)?value:0)} min={min} max={max} step={step} aria-invalid={invalid||undefined}
  onChange={e=>{setDraft(e.target.value);const n=e.target.valueAsNumber;if(valid(n))onChange(n);}}
  onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")commit();}}/></label>;
}
