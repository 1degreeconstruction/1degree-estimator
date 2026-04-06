import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { useForceLightMode } from "@/components/theme-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, MessageCircle, Phone, CalendarCheck, HardHat, FileCheck, Users } from "lucide-react";
import type { Estimate, SalesRep } from "@shared/schema";

type ClientEstimate = Estimate & {
  salesRep?: SalesRep;
};

export default function ClientConfirmation() {
  const params = useParams<{ uniqueId: string }>();

  // Force light mode for client pages
  useForceLightMode();

  const { data: estimate, isLoading } = useQuery<ClientEstimate>({
    queryKey: ["/api/estimates/public", params.uniqueId],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Skeleton className="h-96 w-96" />
      </div>
    );
  }

  const steps = [
    {
      icon: <MessageCircle className="w-5 h-5" />,
      title: "Group Chat Setup",
      description: "Our office will create a group chat with your project team for seamless communication.",
    },
    {
      icon: <Phone className="w-5 h-5" />,
      title: "Onboarding Call",
      description: `${estimate?.salesRep?.name || "Your project manager"} will reach out to schedule an onboarding call.`,
    },
    {
      icon: <CalendarCheck className="w-5 h-5" />,
      title: "Design & Planning",
      description: "Final details and design decisions will be made leading up to construction.",
    },
    ...(estimate?.permitRequired ? [{
      icon: <FileCheck className="w-5 h-5" />,
      title: "Permits",
      description: "Permits will be filed and processed with the appropriate authorities.",
    }] : []),
    {
      icon: <Users className="w-5 h-5" />,
      title: "Preconstruction Meeting",
      description: "A preconstruction meeting will be held with our crew to finalize all details.",
    },
    {
      icon: <HardHat className="w-5 h-5" />,
      title: "Construction Begins",
      description: "Your project officially kicks off!",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background" data-testid="confirmation-page">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        {/* Success Icon */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="font-display text-xl font-bold mb-2" data-testid="text-thank-you">
            Thank You, {estimate?.clientName}!
          </h1>
          <p className="text-muted-foreground">
            Your estimate has been accepted and signed. We're excited to get started on your project.
          </p>
        </div>

        {/* Next Steps */}
        <Card className="bg-white dark:bg-card mb-8" data-testid="card-next-steps">
          <CardContent className="pt-6">
            <h2 className="font-display text-lg font-bold mb-6">What Happens Next</h2>
            <div className="space-y-6">
              {steps.map((step, idx) => (
                <div key={idx} className="flex gap-4" data-testid={`step-${idx}`}>
                  <div className="shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    {step.icon}
                  </div>
                  <div className="pt-1">
                    <h3 className="font-semibold text-sm">{step.title}</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Email Confirmation Note */}
        <p className="text-center text-sm text-muted-foreground" data-testid="text-email-confirmation">
          A confirmation email with these details will be sent to{" "}
          <span className="font-medium text-foreground">{estimate?.clientEmail}</span>
        </p>

        {/* Contact */}
        {estimate?.salesRep && (
          <Card className="bg-white dark:bg-card mt-6" data-testid="card-contact">
            <CardContent className="pt-5 text-center">
              <p className="text-sm text-muted-foreground mb-1">Questions? Contact your project lead:</p>
              <p className="font-semibold text-sm">{estimate.salesRep.name}</p>
              <p className="text-sm text-muted-foreground">{estimate.salesRep.email} · {estimate.salesRep.phone}</p>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t text-center text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} 1 Degree Construction. All rights reserved.</p>
        </footer>
      </div>
    </div>
  );
}
