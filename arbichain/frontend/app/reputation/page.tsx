"use client"

import { useEffect, useState } from "react"
import {
  Shield,
  Info,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from "lucide-react"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { Header } from "@/components/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

interface ReputationTerms {
  taskAmount: string
  suggestedDeposit: string
  depositPercent: number
  requiresArbitration: boolean
}

export default function ReputationPage() {
  const [terms, setTerms] = useState<ReputationTerms | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTerms = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/reputation")
      if (!res.ok) throw new Error("Failed to fetch reputation terms")
      const data = await res.json()
      setTerms(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTerms()
  }, [])

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Header
          title="Reputation Gate"
          description="Understand how reputation affects task terms"
        />
        <main className="flex-1 p-6">
          <div className="mx-auto max-w-4xl space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                    <Shield className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <CardTitle>Reputation-Based Terms</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      How the system calculates suggested terms based on
                      participant reputation
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="flex items-start gap-3">
                    <Info className="mt-0.5 h-5 w-5 text-primary" />
                    <div className="space-y-2 text-sm">
                      <p>
                        The Whistle reputation system dynamically adjusts task
                        terms based on the historical behavior of buyers and
                        sellers. This creates a trust layer that:
                      </p>
                      <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
                        <li>
                          Reduces required deposits for trusted participants
                        </li>
                        <li>
                          Waives arbitration requirements for high-reputation
                          pairs
                        </li>
                        <li>
                          Protects new participants with higher security
                          deposits
                        </li>
                        <li>
                          Updates reputation after each task completion or
                          dispute
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">
                        Reputation Tiers
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-success/10 text-success">
                              Trusted
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              700-1000
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            0% deposit
                          </span>
                        </div>
                        <Progress value={90} className="h-2" />
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-primary/10 text-primary">
                              Established
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              500-699
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            10% deposit
                          </span>
                        </div>
                        <Progress value={65} className="h-2" />
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-warning/10 text-warning">
                              New
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              300-499
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            25% deposit
                          </span>
                        </div>
                        <Progress value={40} className="h-2" />
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-destructive/10 text-destructive">
                              Untrusted
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              0-299
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            50% deposit
                          </span>
                        </div>
                        <Progress value={15} className="h-2" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">
                        Reputation Factors
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-3 rounded-lg border p-3">
                        <CheckCircle2 className="h-5 w-5 text-success" />
                        <div>
                          <p className="text-sm font-medium">
                            Tasks Completed
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Buyer: +10, Seller: +20
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 rounded-lg border p-3">
                        <CheckCircle2 className="h-5 w-5 text-success" />
                        <div>
                          <p className="text-sm font-medium">Disputes Won</p>
                          <p className="text-xs text-muted-foreground">
                            +5 reputation when ruling is in your favor
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 rounded-lg border p-3">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                        <div>
                          <p className="text-sm font-medium">Disputes Lost</p>
                          <p className="text-xs text-muted-foreground">
                            -50 reputation when ruling is against you
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 rounded-lg border p-3">
                        <AlertTriangle className="h-5 w-5 text-warning" />
                        <div>
                          <p className="text-sm font-medium">Dispute Opened</p>
                          <p className="text-xs text-muted-foreground">
                            Seller: -10 when a dispute is opened
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Suggested Terms Calculator</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchTerms}
                  disabled={loading}
                >
                  <RefreshCw
                    className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
                  />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent>
                {error && (
                  <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-destructive">
                    {error}
                  </div>
                )}

                {loading && !terms ? (
                  <div className="grid gap-4 md:grid-cols-4">
                    {[1, 2, 3, 4].map((i) => (
                      <Skeleton key={i} className="h-24 rounded-lg" />
                    ))}
                  </div>
                ) : terms ? (
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="rounded-lg border bg-muted/30 p-4 text-center">
                      <p className="text-sm text-muted-foreground">
                        Task Amount
                      </p>
                      <p className="mt-2 text-2xl font-bold text-primary">
                        {terms.taskAmount}
                      </p>
                    </div>

                    <div className="rounded-lg border bg-muted/30 p-4 text-center">
                      <p className="text-sm text-muted-foreground">
                        Suggested Deposit
                      </p>
                      <p className="mt-2 text-2xl font-bold">
                        {terms.suggestedDeposit}
                      </p>
                    </div>

                    <div className="rounded-lg border bg-muted/30 p-4 text-center">
                      <p className="text-sm text-muted-foreground">
                        Deposit Percent
                      </p>
                      <p className="mt-2 text-2xl font-bold">
                        {terms.depositPercent}%
                      </p>
                    </div>

                    <div className="rounded-lg border bg-muted/30 p-4 text-center">
                      <p className="text-sm text-muted-foreground">
                        Requires Arbitration
                      </p>
                      <div className="mt-2">
                        <Badge
                          variant={
                            terms.requiresArbitration
                              ? "destructive"
                              : "default"
                          }
                          className={
                            !terms.requiresArbitration
                              ? "bg-success text-success-foreground"
                              : ""
                          }
                        >
                          {terms.requiresArbitration ? "Yes" : "No"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ) : null}

                <p className="mt-4 text-center text-sm text-muted-foreground">
                  These terms are calculated based on the current reputation of
                  the demo buyer and seller.
                </p>
              </CardContent>
            </Card>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
