import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/lib/language-context";
import NotFound from "@/pages/not-found";
import LandingPage from "./pages/LandingPage";
import Dashboard from "./pages/dashboard";
import Login from "./pages/login";
import Guide from "./pages/guide";
import Statistics from "./pages/statistics";
import ChatbotConfig from "./pages/ChatbotConfig";
import Meetings from "./pages/Meetings";
import BookMeeting from "./pages/BookMeeting";
import SurveyPage from "./pages/SurveyPage";
import SurveysTab from "./pages/SurveysTab";
import MeetingPage from "./pages/MeetingPage";
import InboxPage from "./pages/InboxPage";
import AgentsTab from "./pages/AgentsTab";
import ContactsPage from "./pages/ContactsPage";
import CustomersPage from "./pages/CustomersPage";
import TermsPage from "./pages/TermsPage";
import RegisterPage from "./pages/RegisterPage";
import BookDemo from "./pages/BookDemo";

function Router() {
  return (
    <Switch>
      {/* Public routes — must come before any auth-guarded routes */}
      <Route path="/terms" component={TermsPage} />
      <Route path="/book-demo" component={BookDemo} />
      <Route path="/survey/:token" component={SurveyPage} />
      <Route path="/meeting/:token" component={MeetingPage} />
      <Route path="/book/:token" component={BookMeeting} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/login" component={Login} />
      <Route path="/guide" component={Guide} />
      <Route path="/statistics" component={Statistics} />
      <Route path="/chatbot-config" component={ChatbotConfig} />
      <Route path="/meetings" component={Meetings} />
      <Route path="/surveys" component={SurveysTab} />
      <Route path="/inbox" component={InboxPage} />
      <Route path="/agents" component={AgentsTab} />
      <Route path="/contacts" component={ContactsPage} />
      <Route path="/customers" component={CustomersPage} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/" component={LandingPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

export default App;
