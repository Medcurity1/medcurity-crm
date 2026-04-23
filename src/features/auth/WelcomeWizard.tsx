import { useState } from "react";
import { branding } from "@/lib/branding";
import { formatModShortcut } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Home,
  Building2,
  UserPlus,
  Target,
  BarChart3,
  Command,
  MousePointerClick,
  Plus,
  Rocket,
} from "lucide-react";

const STORAGE_KEY = "crm_onboarded";

const TOTAL_STEPS = 4;

interface WelcomeWizardProps {
  open: boolean;
  onComplete: () => void;
}

export function WelcomeWizard({ open, onComplete }: WelcomeWizardProps) {
  const [step, setStep] = useState(0);

  function finish() {
    // Keep legacy localStorage flag in sync for any code paths still
    // reading it; real source of truth is user_profiles.onboarded_at,
    // set by AuthProvider.markOnboarded() which onComplete invokes.
    localStorage.setItem(STORAGE_KEY, "true");
    onComplete();
  }

  function handleSkip() {
    finish();
  }

  function handleNext() {
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
    } else {
      finish();
    }
  }

  function handleBack() {
    setStep((s) => Math.max(0, s - 1));
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Welcome Wizard</DialogTitle>
        <DialogDescription className="sr-only">
          A guided setup wizard to help you get started with the CRM.
        </DialogDescription>

        {/* Skip link */}
        <button
          type="button"
          onClick={handleSkip}
          className="absolute top-4 right-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip
        </button>

        {/* Step indicator dots */}
        <div className="flex justify-center gap-2 pt-2">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`h-2 w-2 rounded-full transition-colors ${
                i === step
                  ? "bg-primary"
                  : i < step
                    ? "bg-primary/40"
                    : "bg-muted-foreground/20"
              }`}
            />
          ))}
        </div>

        {/* Content area */}
        <div className="min-h-[260px] flex flex-col justify-center py-4">
          {step === 0 && <StepWelcome />}
          {step === 1 && <StepNavigation />}
          {step === 2 && <StepQuickActions />}
          {step === 3 && <StepReady />}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between">
          <div>
            {step > 0 && (
              <Button variant="ghost" onClick={handleBack}>
                Back
              </Button>
            )}
          </div>
          <Button onClick={handleNext}>
            {step === 0
              ? "Get Started"
              : step === TOTAL_STEPS - 1
                ? "Go to Dashboard"
                : "Next"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepWelcome() {
  return (
    <div className="text-center space-y-4">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <Rocket className="h-8 w-8 text-primary" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">
          Welcome to {branding.companyName} {branding.productName}!
        </h2>
        <p className="text-muted-foreground text-sm">
          Let's get you set up in a few quick steps.
        </p>
      </div>
    </div>
  );
}

function StepNavigation() {
  const navItems = [
    { icon: Home, label: "Home", desc: "Your personalized dashboard" },
    {
      icon: Building2,
      label: "Accounts & Contacts",
      desc: "Manage your relationships",
    },
    { icon: UserPlus, label: "Leads", desc: "Track and convert prospects" },
    {
      icon: Target,
      label: "Opportunities & Pipeline",
      desc: "Manage your deals",
    },
    {
      icon: BarChart3,
      label: "Reports",
      desc: "Build custom reports and dashboards",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold tracking-tight">
          Navigating the CRM
        </h2>
      </div>
      <div className="space-y-3">
        {navItems.map((item) => (
          <div key={item.label} className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <item.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepQuickActions() {
  const tips = [
    {
      icon: Command,
      shortcut: "K",
      text: `Press ${formatModShortcut("K")} to search across all records`,
    },
    {
      icon: MousePointerClick,
      shortcut: null,
      text: "Click any stage in the pipeline to change it",
    },
    {
      icon: Plus,
      shortcut: null,
      text: "Use the + button to create records from anywhere",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold tracking-tight">Quick Tips</h2>
      </div>
      <div className="space-y-3">
        {tips.map((tip, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <tip.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground pt-1">{tip.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepReady() {
  return (
    <div className="text-center space-y-4">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
        <span className="text-3xl" role="img" aria-label="checkmark">
          &#10003;
        </span>
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">
          You're all set!
        </h2>
        <p className="text-muted-foreground text-sm">
          Start by exploring your dashboard or creating your first record.
        </p>
      </div>
    </div>
  );
}
