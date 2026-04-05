import { lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { LoginPage } from "@/features/auth/LoginPage";
import { AppLayout } from "@/components/layout/AppLayout";

// Lazy-loaded route components for code splitting
const HomePage = lazy(() => import("@/features/dashboard/HomePage").then(m => ({ default: m.HomePage })));
const NotFound = lazy(() => import("@/features/NotFound").then(m => ({ default: m.NotFound })));
const AccountsList = lazy(() => import("@/features/accounts/AccountsList").then(m => ({ default: m.AccountsList })));
const AccountDetail = lazy(() => import("@/features/accounts/AccountDetail").then(m => ({ default: m.AccountDetail })));
const AccountForm = lazy(() => import("@/features/accounts/AccountForm").then(m => ({ default: m.AccountForm })));
const LeadsList = lazy(() => import("@/features/leads/LeadsList").then(m => ({ default: m.LeadsList })));
const LeadDetail = lazy(() => import("@/features/leads/LeadDetail").then(m => ({ default: m.LeadDetail })));
const LeadForm = lazy(() => import("@/features/leads/LeadForm").then(m => ({ default: m.LeadForm })));
const ContactsList = lazy(() => import("@/features/contacts/ContactsList").then(m => ({ default: m.ContactsList })));
const ContactDetail = lazy(() => import("@/features/contacts/ContactDetail").then(m => ({ default: m.ContactDetail })));
const ContactForm = lazy(() => import("@/features/contacts/ContactForm").then(m => ({ default: m.ContactForm })));
const OpportunitiesList = lazy(() => import("@/features/opportunities/OpportunitiesList").then(m => ({ default: m.OpportunitiesList })));
const OpportunityDetail = lazy(() => import("@/features/opportunities/OpportunityDetail").then(m => ({ default: m.OpportunityDetail })));
const OpportunityForm = lazy(() => import("@/features/opportunities/OpportunityForm").then(m => ({ default: m.OpportunityForm })));
const PipelineBoard = lazy(() => import("@/features/opportunities/PipelineBoard").then(m => ({ default: m.PipelineBoard })));
const ProductsPage = lazy(() => import("@/features/products/ProductsPage").then(m => ({ default: m.ProductsPage })));
const RenewalsQueue = lazy(() => import("@/features/renewals/RenewalsQueue").then(m => ({ default: m.RenewalsQueue })));
const ReportBuilder = lazy(() => import("@/features/reports/ReportBuilder").then(m => ({ default: m.ReportBuilder })));
const ForecastPage = lazy(() => import("@/features/forecasting/ForecastPage").then(m => ({ default: m.ForecastPage })));
const ActivityCalendar = lazy(() => import("@/features/activities/ActivityCalendar").then(m => ({ default: m.ActivityCalendar })));
const ActivitiesListPage = lazy(() => import("@/features/activities/ActivitiesListPage").then(m => ({ default: m.ActivitiesListPage })));
const WinLossAnalysis = lazy(() => import("@/features/analytics/WinLossAnalysis").then(m => ({ default: m.WinLossAnalysis })));
const SequencesPage = lazy(() => import("@/features/sequences/SequencesPage").then(m => ({ default: m.SequencesPage })));
const EmailTemplatesPage = lazy(() => import("@/features/email-templates/EmailTemplatesPage").then(m => ({ default: m.EmailTemplatesPage })));
const LeadListsPage = lazy(() => import("@/features/lead-lists/LeadListsPage").then(m => ({ default: m.LeadListsPage })));
const ArchiveManager = lazy(() => import("@/features/archive/ArchiveManager").then(m => ({ default: m.ArchiveManager })));
const AdminSettings = lazy(() => import("@/features/admin/AdminSettings").then(m => ({ default: m.AdminSettings })));

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  <Route index element={<HomePage />} />
                  <Route path="accounts" element={<AccountsList />} />
                  <Route path="accounts/new" element={<AccountForm />} />
                  <Route path="accounts/:id" element={<AccountDetail />} />
                  <Route path="accounts/:id/edit" element={<AccountForm />} />
                  <Route path="leads" element={<LeadsList />} />
                  <Route path="leads/new" element={<LeadForm />} />
                  <Route path="leads/:id" element={<LeadDetail />} />
                  <Route path="leads/:id/edit" element={<LeadForm />} />
                  <Route path="lead-lists" element={<LeadListsPage />} />
                  <Route path="sequences" element={<SequencesPage />} />
                  <Route path="email-templates" element={<EmailTemplatesPage />} />
                  <Route path="contacts" element={<ContactsList />} />
                  <Route path="contacts/new" element={<ContactForm />} />
                  <Route path="contacts/:id" element={<ContactDetail />} />
                  <Route path="contacts/:id/edit" element={<ContactForm />} />
                  <Route path="opportunities" element={<OpportunitiesList />} />
                  <Route path="opportunities/new" element={<OpportunityForm />} />
                  <Route path="opportunities/:id" element={<OpportunityDetail />} />
                  <Route path="opportunities/:id/edit" element={<OpportunityForm />} />
                  <Route path="pipeline" element={<PipelineBoard />} />
                  <Route path="calendar" element={<ActivityCalendar />} />
                  <Route path="activities" element={<ActivitiesListPage />} />
                  <Route path="analytics" element={<WinLossAnalysis />} />
                  <Route path="products" element={<ProductsPage />} />
                  <Route path="renewals" element={<RenewalsQueue />} />
                  <Route path="reports" element={<ReportBuilder />} />
                  <Route path="forecasting" element={<ForecastPage />} />
                  <Route path="archive" element={<ArchiveManager />} />
                  <Route path="admin" element={<AdminSettings />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Route>
            </Routes>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
