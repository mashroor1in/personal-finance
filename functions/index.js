import { onRequestPost as authLogin } from "./api/auth/login.js";
import { onRequestPost as authLogout } from "./api/auth/logout.js";
import { onRequestGet as authMe } from "./api/auth/me.js";
import { onRequestGet as authStatus } from "./api/auth/status.js";
import { onRequestPost as dataHandler } from "./api/data/index.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle auth endpoints
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      return authLogin({ request, env });
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return authLogout({ request, env });
    }
    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      return authMe({ request, env });
    }
    if (url.pathname === "/api/auth/status" && request.method === "GET") {
      return authStatus({ request, env });
    }
    
    // Handle data endpoints
    if (url.pathname.startsWith("/api/data") && request.method === "POST") {
      return dataHandler({ request, env });
    }
    
    // Handle month-specific data endpoints
    const monthMatch = url.pathname.match(/^\/api\/data\/month\/([^\/]+)$/);
    if (monthMatch && request.method === "POST") {
      const { onRequestPost: monthHandler } = await import(`./api/data/month/[month].js`);
      return monthHandler({ 
        request, 
        env,
        params: { month: monthMatch[1] }
      });
    }
    
    // Handle month GET requests
    if (monthMatch && request.method === "GET") {
      const { onRequestGet: monthHandler } = await import(`./api/data/month/[month].js`);
      return monthHandler({ 
        request, 
        env,
        params: { month: monthMatch[1] }
      });
    }
    
    // Return 404 for unhandled routes
    return new Response("Not Found", { status: 404 });
  }
};