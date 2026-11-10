import { useState } from "react";
import { ArrowRight, Info } from "lucide-react";
import { Modal } from "../components/ui/Modal";
import { guideUrl, HELP, type HelpTopic, type HelpTopicId } from "./help";

/** A topic's functions, steps and guide, as the "i" buttons and the Learn page show it. */
export function HelpBody({ topic }: { topic: HelpTopic }) {
  const url = topic.guide && guideUrl(topic.guide.file);
  return <div className="help-body">
    <h3>Main functions</h3>
    <ul>{topic.functions.map((item) => <li key={item}>{item}</li>)}</ul>
    <h3>How to use it</h3>
    <ol>{topic.steps.map((item) => <li key={item}>{item}</li>)}</ol>
    {url && <a href={url} target="_blank" rel="noreferrer">{topic.guide!.label}<ArrowRight/></a>}
  </div>;
}

/** An "i" button that explains a tab or mode: what it is for, its main functions, and how to use it. */
export function InfoButton({ topic, className = "" }: { topic: HelpTopicId; className?: string }) {
  const [open, setOpen] = useState(false);
  const help = HELP[topic];
  return <>
    <button type="button" className={`info-button ${className}`.trim()} aria-label={`About ${help.title}`} title={`About ${help.title}`} onClick={() => setOpen(true)}><Info aria-hidden="true"/></button>
    <Modal open={open} title={help.title} description={help.summary} onClose={() => setOpen(false)}>
      <HelpBody topic={help}/>
    </Modal>
  </>;
}
