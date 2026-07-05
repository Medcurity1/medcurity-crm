import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider, useAuth } from "@/features/auth/AuthProvider";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { LoginPage } from "@/features/auth/LoginPage";
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage";
import { AppLayout } from "@/components/layout/AppLayout";

// Lazy-loaded route components for code splitting
const HomePage = lazy(() => import("@/features/dashboard/HomePage").then(m => ({ default: m.HomePage })));
const NexusPage = lazy(() => import("@/features/nexus/NexusPage").then(m => ({ default: m.NexusPage })));
const RequestsPage = lazy(() => import("@/features/requests/RequestsPage").then(m => ({ default: m.RequestsPage })));
const MeddyPage = lazy(() => import("@/features/meddy/MeddyPage").then(m => ({ default: m.MeddyPage })));
const SupportPage = lazy(() => import("@/features/support/SupportPage").then(m => ({ default: m.SupportPage })));
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
const ProductDetail = lazy(() => import("@/features/products/ProductDetail").then(m => ({ default: m.ProductDetail })));
const RenewalsQueue = lazy(() => import("@/features/renewals/RenewalsQueue").then(m => ({ default: m.RenewalsQueue })));
const ReportsHub = lazy(() => import("@/features/reports/ReportsHub").then(m => ({ default: m.ReportsHub })));
const TeamDashboardTv = lazy(() => import("@/features/reports/TeamDashboardTv").then(m => ({ default: m.TeamDashboardTv })));
// ForecastPage is now only reached via /reports?tab=forecasting and
// lazy-loaded inside ReportsHub.
const ActivityCalendar = lazy(() => import("@/features/activities/ActivityCalendar").then(m => ({ default: m.ActivityCalendar })));
const ActivitiesListPage = lazy(() => import("@/features/activities/ActivitiesListPage").then(m => ({ default: m.ActivitiesListPage })));
const ActivityDetail = lazy(() => import("@/features/activities/ActivityDetail").then(m => ({ default: m.ActivityDetail })));
const ArrBaseDataset = lazy(() => import("@/features/reports/standard/ArrBaseDataset").then(m => ({ default: m.ArrBaseDataset })));
const NewCustomers = lazy(() => import("@/features/reports/standard/NewCustomers").then(m => ({ default: m.NewCustomers })));
const LostCustomers = lazy(() => import("@/features/reports/standard/LostCustomers").then(m => ({ default: m.LostCustomers })));
const LostCustomersAccount = lazy(() => import("@/features/reports/standard/LostCustomersAccount").then(m => ({ default: m.LostCustomersAccount })));
const ArpcByQuarter = lazy(() => import("@/features/reports/standard/ArpcByQuarter").then(m => ({ default: m.ArpcByQuarter })));
const FinancialSaasMetrics = lazy(() => import("@/features/reports/standard/FinancialSaasMetrics").then(m => ({ default: m.FinancialSaasMetrics })));
const ActivePipeline = lazy(() => import("@/features/reports/standard/ActivePipeline").then(m => ({ default: m.ActivePipeline })));
const RenewalsReport = lazy(() => import("@/features/reports/standard/RenewalsQueue").then(m => ({ default: m.RenewalsQueue })));
const SqlAccounts = lazy(() => import("@/features/reports/standard/SqlAccounts").then(m => ({ default: m.SqlAccounts })));
const MqlContacts = lazy(() => import("@/features/reports/standard/MqlContacts").then(m => ({ default: m.MqlContacts })));
const DoNotEmail = lazy(() => import("@/features/reports/standard/DoNotEmail").then(m => ({ default: m.DoNotEmail })));
const DashboardMetrics = lazy(() => import("@/features/reports/standard/DashboardMetrics").then(m => ({ default: m.DashboardMetrics })));
const ReportsDiagnostic = lazy(() => import("@/features/reports/standard/ReportsDiagnostic").then(m => ({ default: m.ReportsDiagnostic })));
// WinLossAnalysis is now only reached via /reports?tab=analytics and
// lazy-loaded inside ReportsHub.
const PartnersPage = lazy(() => import("@/features/partners/PartnersPage").then(m => ({ default: m.PartnersPage })));
const PlaybookPage = lazy(() => import("@/features/playbook/PlaybookPage").then(m => ({ default: m.PlaybookPage })));
const ArchiveManager = lazy(() => import("@/features/archive/ArchiveManager").then(m => ({ default: m.ArchiveManager })));
const AdminSettings = lazy(() => import("@/features/admin/AdminSettings").then(m => ({ default: m.AdminSettings })));
const ImportRunsList = lazy(() => import("@/features/admin/ImportRunsList").then(m => ({ default: m.ImportRunsList })));
const ImportRunDetail = lazy(() => import("@/features/admin/ImportRunDetail").then(m => ({ default: m.ImportRunDetail })));
const UserSettings = lazy(() => import("@/features/settings/UserSettings").then(m => ({ default: m.UserSettings })));
const ChangePasswordPage = lazy(() => import("@/features/auth/ChangePasswordPage").then(m => ({ default: m.ChangePasswordPage })));

/** Route guard for admin-only pages (redirects non-admins to /accounts).
 * RLS is the real enforcement; this just gives non-admins a clean redirect
 * instead of an empty/not-found page on a deep link. */
function AdminGate({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return <Navigate to="/accounts" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route element={<ProtectedRoute />}>
                {/* Office-TV view: full-bleed, no AppLayout chrome. */}
                <Route
                  path="team/tv"
                  element={
                    <Suspense
                      fallback={
                        <div className="fixed inset-0 flex items-center justify-center bg-black text-white text-sm">
                          Loading dashboard…
                        </div>
                      }
                    >
                      <TeamDashboardTv />
                    </Suspense>
                  }
                />
                <Route element={<AppLayout />}>
                  {/* Classic dashboard stays at "/" while Nexus (the
                      customizable widget page) is tested at /nexus
                      (Nathan, 2026-07-03). */}
                  <Route index element={<HomePage />} />
                  <Route path="nexus" element={<NexusPage />} />
                  <Route path="requests" element={<RequestsPage />} />
                  <Route path="meddy" element={<MeddyPage />} />
                  {/* Meddy Support: platform (app.medcurity.com) Coach
                      escalations. Separate stream from /meddy by design. */}
                  <Route path="support" element={<SupportPage />} />
                  <Route path="accounts" element={<AccountsList />} />
                  <Route path="accounts/new" element={<AccountForm />} />
                  <Route path="accounts/:id" element={<AccountDetail />} />
                  <Route path="accounts/:id/edit" element={<AccountForm />} />
                  {/* Leads (admin-only working/import list). Gate the list
                      route too, matching the other leads routes — the
                      component also guards, this is belt-and-suspenders. */}
                  <Route path="leads" element={<AdminGate><LeadsList /></AdminGate>} />
                  <Route path="leads/new" element={<AdminGate><LeadForm /></AdminGate>} />
                  <Route path="leads/:id" element={<AdminGate><LeadDetail /></AdminGate>} />
                  <Route path="leads/:id/edit" element={<AdminGate><LeadForm /></AdminGate>} />
                  <Route path="playbook" element={<AdminGate><PlaybookPage /></AdminGate>} />
                  <Route path="partners" element={<PartnersPage />} />
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
                  <Route path="activities/:id" element={<ActivityDetail />} />
                  <Route path="products" element={<ProductsPage />} />
                  <Route path="products/:id" element={<ProductDetail />} />
                  <Route path="renewals" element={<RenewalsQueue />} />
                  <Route path="reports" element={<ReportsHub />} />
                  <Route path="reports/standard/arr-base-dataset" element={<ArrBaseDataset />} />
                  <Route path="reports/standard/new-customers" element={<NewCustomers />} />
                  <Route path="reports/standard/lost-customers" element={<LostCustomers />} />
                  <Route path="reports/standard/lost-customers-account" element={<LostCustomersAccount />} />
                  <Route path="reports/standard/arpc-by-quarter" element={<ArpcByQuarter />} />
                  <Route path="reports/standard/financial-saas-metrics" element={<FinancialSaasMetrics />} />
                  <Route path="reports/standard/active-pipeline" element={<ActivePipeline />} />
                  <Route path="reports/standard/renewals" element={<RenewalsReport />} />
                  <Route path="reports/standard/sql" element={<SqlAccounts />} />
                  <Route path="reports/standard/mql-contacts" element={<MqlContacts />} />
                  <Route path="reports/standard/do-not-email" element={<DoNotEmail />} />
                  {/* "MQL (Leads)" report retired 2026-06-16 — qualification is
                      a Contact concept now. Old links redirect to MQL (Contacts). */}
                  <Route path="reports/standard/mql-leads" element={<Navigate to="/reports/standard/mql-contacts" replace />} />
                  <Route path="reports/standard/dashboard-metrics" element={<DashboardMetrics />} />
                  <Route path="reports/standard/diagnostic" element={<ReportsDiagnostic />} />
                  {/* Legacy route aliases — keep old URLs working */}
                  <Route path="reports/standard/arr-rolling-365" element={<ArrBaseDataset />} />
                  <Route path="reports/standard/renewals-queue" element={<RenewalsReport />} />
                  <Route path="reports/standard/mql-sql-counts" element={<Navigate to="/reports/standard/mql-contacts" replace />} />
                  {/* Legacy routes redirect into the reports hub tabs */}
                  <Route
                    path="forecasting"
                    element={<Navigate to="/reports?tab=forecasting" replace />}
                  />
                  <Route
                    path="analytics"
                    element={<Navigate to="/reports?tab=analytics" replace />}
                  />
                  <Route path="archive" element={<ArchiveManager />} />
                  <Route path="admin" element={<AdminSettings />} />
                  <Route path="admin/imports" element={<ImportRunsList />} />
                  <Route path="admin/imports/:runId" element={<ImportRunDetail />} />
                  <Route path="settings" element={<UserSettings />} />
                  <Route path="change-password" element={<ChangePasswordPage />} />
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
