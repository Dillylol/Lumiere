import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import "monaco-editor/languages/definitions/java/register";
import { useEffect, useRef } from "react";
import { addImports, javaCompletions, type BuildProblem } from "../core";

(globalThis as typeof globalThis & {MonacoEnvironment:unknown}).MonacoEnvironment={getWorker:()=>new EditorWorker()};loader.config({monaco});
monaco.editor.defineTheme("graphite",{base:"vs-dark",inherit:true,rules:[{token:"comment",foreground:"89958B"},{token:"keyword",foreground:"E9B677"},{token:"string",foreground:"B6CFAD"}],colors:{"editor.background":"#17191b","editorLineNumber.foreground":"#737A81","editor.selectionBackground":"#5A4835","editor.lineHighlightBackground":"#202225"}});
monaco.languages.registerCompletionItemProvider("java",{triggerCharacters:["."],provideCompletionItems(model,position){
 const result=javaCompletions(model.getValue(),model.getOffsetAt(position));const from=model.getPositionAt(result.from);
 return {suggestions:result.items.map(item=>{
   const source=model.getValue(),withImports=addImports(source,item.imports);let extra:monaco.languages.CompletionItem["additionalTextEdits"];
   if(withImports!==source){let prefix=0;while(prefix<source.length&&source[prefix]===withImports[prefix])prefix++;const at=model.getPositionAt(prefix);extra=[{range:new monaco.Range(at.lineNumber,at.column,at.lineNumber,at.column),text:withImports.slice(prefix,prefix+withImports.length-source.length)}];}
   return {label:item.label,kind:item.kind==="class"?monaco.languages.CompletionItemKind.Class:item.kind==="snippet"?monaco.languages.CompletionItemKind.Snippet:monaco.languages.CompletionItemKind.Method,insertText:item.insertText,insertTextRules:item.snippet?monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet:undefined,detail:item.detail,documentation:{value:`${item.documentation??""}${item.docs?`\n\n[Documentation](${item.docs})`:""}`},range:new monaco.Range(from.lineNumber,from.column,position.lineNumber,position.column),additionalTextEdits:extra};})};
}});
export default function JavaEditor({value,path,readOnly,onChange,problems=[],line}:{value:string;path:string;readOnly:boolean;onChange:(s:string)=>void;problems?:BuildProblem[];line?:number}){
 const ref=useRef<monaco.editor.IStandaloneCodeEditor|null>(null);
 const markers=()=>{const model=ref.current?.getModel();if(model)monaco.editor.setModelMarkers(model,"javac",problems.map(p=>({message:p.message,severity:p.severity==="error"?monaco.MarkerSeverity.Error:monaco.MarkerSeverity.Warning,startLineNumber:p.line??1,endLineNumber:p.line??1,startColumn:p.column??1,endColumn:(p.column??1)+1})));};
 useEffect(markers,[problems,path]);useEffect(()=>{if(line){ref.current?.revealLineInCenter(line);ref.current?.setPosition({lineNumber:line,column:1});}},[line,path]);
 return <Editor path={path} height="100%" language="java" theme={document.documentElement.dataset.theme==="light"?"vs":"graphite"} value={value} onChange={v=>onChange(v??"")} onMount={editor=>{ref.current=editor;markers();}} options={{readOnly,fontSize:14,lineHeight:23,fontFamily:"Cascadia Code, Consolas, monospace",minimap:{enabled:false},scrollBeyondLastLine:false,automaticLayout:true,padding:{top:16},ariaLabel:readOnly?"Generated Java":"Java editor",wordWrap:"on"}}/>;
}
