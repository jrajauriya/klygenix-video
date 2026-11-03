import { Check } from "lucide-react"
import { cn } from "../utils"

export interface StepperProps {
  steps: string[]
  currentStep: number
  className?: string
}

export function Stepper({ steps, currentStep, className }: StepperProps) {
  return (
    <div className={cn("mb-6 flex items-center px-2", className)}>
      {steps.map((label, i) => (
        <div key={label} className="flex flex-1 items-center last:flex-none">
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-medium",
                i < currentStep && "bg-green-500 text-white",
                i === currentStep && "bg-navy text-surface",
                i > currentStep && "bg-slate-100 text-slate-500"
              )}
            >
              {i < currentStep ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span
              className={cn(
                "whitespace-nowrap text-sm",
                i < currentStep && "text-green-600",
                i === currentStep && "font-semibold text-navy",
                i > currentStep && "text-slate-500"
              )}
            >
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "mx-2 h-0.5 flex-1",
                i < currentStep ? "bg-green-500" : "bg-slate-100"
              )}
            />
          )}
        </div>
      ))}
    </div>
  )
}
