"use client"

import { useState, useEffect } from "react"
import { RotateCcw, Play } from "lucide-react"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Header } from "@/components/header"
import { DemoStepper, type Step } from "@/components/demo-stepper"
import { ResultViewer } from "@/components/result-viewer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"

const steps: Step[] = [
  {
    id: "create-task",
    label: "Create Task",
    description:
      "Buyer creates task with on-chain delivery/review deadlines, escrows funds on TRON",
  },
  {
    id: "submit-deliverable",
    label: "AI Seller Generates & Submits",
    description:
      "AI seller agent generates quality content via GPT-4o-mini, stores on Filecoin, submits on-chain",
  },
  {
    id: "approve",
    label: "AI Buyer Reviews & Approves",
    description:
      "AI buyer agent evaluates deliverable against structured rubric, approves on-chain, funds released",
  },
]

interface StepResult {
  step: string
  data: Record<string, unknown>
}

const STORAGE_KEY = "whistle-happy-demo"

function loadCache(): StepResult[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export default function HappyPathPage() {
  const [currentStep, setCurrentStep] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<number[]>([])
  const [loadingStep, setLoadingStep] = useState<number | null>(null)
  const [results, setResults] = useState<StepResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cache, setCache] = useState<StepResult[]>([])

  useEffect(() => { setCache(loadCache()) }, [])

  const saveCache = (updated: StepResult[]) => {
    setCache(updated)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  }

  const runStep = async (stepIndex: number) => {
    const step = steps[stepIndex]
    setLoadingStep(stepIndex)
    setError(null)

    const cached = cache.find((r) => r.step === step.id)
    if (cached) {
      await new Promise((r) => setTimeout(r, 2000))
      setResults((prev) => [...prev, cached])
      setCompletedSteps((prev) => [...prev, stepIndex])
      setCurrentStep(stepIndex + 1)
      toast.success(`${step.label} completed successfully`)
      setLoadingStep(null)
      return
    }

    try {
      const res = await fetch("/api/demo/happy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: step.id }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to execute step")
      }

      const entry: StepResult = { step: step.id, data }
      setResults((prev) => [...prev, entry])
      setCompletedSteps((prev) => [...prev, stepIndex])
      setCurrentStep(stepIndex + 1)
      saveCache([...cache, entry])
      toast.success(`${step.label} completed successfully`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      setError(message)
      toast.error(message)
    } finally {
      setLoadingStep(null)
    }
  }

  const reset = () => {
    setCurrentStep(0)
    setCompletedSteps([])
    setResults([])
    setError(null)
  }

  const isComplete = completedSteps.length === steps.length

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Header
          title="Happy Path Demo"
          description="Walk through successful completion with enforceable protocol deadlines"
        />
        <main className="flex-1 p-6">
          <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
            Each step involves an OpenAI API call, a Filecoin upload through Synapse SDK, and a TRON transaction that needs on-chain confirmation. The demo takes a few minutes to run, so please be patient.
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Demo Steps</CardTitle>
                  <Button variant="outline" size="sm" onClick={reset}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reset
                  </Button>
                </CardHeader>
                <CardContent>
                  <DemoStepper
                    steps={steps}
                    currentStep={currentStep}
                    completedSteps={completedSteps}
                    loadingStep={loadingStep}
                  />

                  <div className="mt-6 border-t pt-6">
                    {isComplete ? (() => {
                      const lastResult = results[results.length - 1]?.data;
                      const txHash = lastResult?.txHash as string | undefined;
                      const explorerUrl = lastResult?.explorerUrl as string | undefined;
                      return (
                        <div className="rounded-lg border border-success/20 bg-success/5 p-4 text-center space-y-2">
                          <p className="font-semibold text-success">
                            Task Complete!
                          </p>
                          <p className="text-sm text-muted-foreground">
                            AI seller delivered, AI buyer approved. Funds released
                            to seller on-chain.
                          </p>
                          {txHash && (
                            <p className="font-mono text-xs text-muted-foreground truncate">
                              Payment tx: {txHash}
                            </p>
                          )}
                          {explorerUrl && (
                            <a
                              href={explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              Verify on TronScan &rarr;
                            </a>
                          )}
                        </div>
                      );
                    })() : (
                      <Button
                        className="w-full"
                        onClick={() => runStep(currentStep)}
                        disabled={loadingStep !== null}
                      >
                        <Play className="mr-2 h-4 w-4" />
                        Run: {steps[currentStep].label}
                      </Button>
                    )}
                  </div>

                  {error && (
                    <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                      <p className="text-sm text-destructive">{error}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => runStep(currentStep)}
                      >
                        Retry
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Results Log</h3>
              {results.length === 0 ? (
                <Card className="flex min-h-[200px] items-center justify-center">
                  <p className="text-sm text-muted-foreground">
                    Run a step to see results here
                  </p>
                </Card>
              ) : (
                <div className="space-y-4">
                  {results.map((result, index) => (
                    <ResultViewer
                      key={index}
                      result={result.data}
                      title={
                        steps.find((s) => s.id === result.step)?.label ||
                        result.step
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
