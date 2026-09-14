import { BRAND } from "../brand";
import { ArrowRight, Blocks, Code2 } from "lucide-react";
import type { ExperienceMode } from "../models/project";

interface OnboardingProps {
  onChoose: (mode: ExperienceMode) => void;
}

export function Onboarding({ onChoose }: OnboardingProps) {
  return (
    <main className="onboarding-shell">
      <a className="skip-link" href="#mode-options">Skip to mode choices</a>
      <section className="onboarding-card" aria-labelledby="welcome-title">
        <div className="brand-mark brand-mark--large" aria-hidden="true">{BRAND.name[0]}</div>
        <h1 id="welcome-title">Welcome to {BRAND.name}</h1>
        <p className="onboarding-lede">Learn the ideas, build the program, and understand the FTC Java that runs on your robot.</p>
        <fieldset id="mode-options" className="mode-grid">
          <legend>Choose your starting experience</legend>
          <button className="mode-card mode-card--recommended" type="button" onClick={() => onChoose("beginner")}>
            <span className="mode-card__icon"><Blocks aria-hidden="true" /></span>
            <span className="mode-card__copy">
              <span className="mode-card__label">Beginner</span>
              <strong>Build with guided actions</strong>
              <span>Use a structured visual workflow with explanations, safe values, and synchronized code.</span>
            </span>
            <span className="mode-card__meta">Recommended <ArrowRight aria-hidden="true" /></span>
          </button>
          <button className="mode-card" type="button" onClick={() => onChoose("advanced")}>
            <span className="mode-card__icon"><Code2 aria-hidden="true" /></span>
            <span className="mode-card__copy">
              <span className="mode-card__label">Advanced</span>
              <strong>Work in the {BRAND.name} IDE</strong>
              <span>Edit {BRAND.name} source with diagnostics, project-aware completion, and generated FTC Java.</span>
            </span>
            <span className="mode-card__meta">Switch anytime <ArrowRight aria-hidden="true" /></span>
          </button>
        </fieldset>
        <button className="text-button onboarding-skip" onClick={() => onChoose("beginner")}>Continue to projects <ArrowRight /></button>
        <p className="privacy-note">No account, robot, AI service, or internet connection required.</p>
      </section>
    </main>
  );
}
