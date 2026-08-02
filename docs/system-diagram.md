# System diagram

Architecture overview (Mermaid).

```mermaid
flowchart TB
  subgraph Clients["Clients"]
    Web[Web]
    Slack[Slack]
    API[API]
  end

  subgraph Identity["Identity + Access (Cloudflare)"]
    SignIn["Configured Better Auth Sign-In\nCredential | Social | OIDC"]
    AccountLink["Explicit Account Linking + API Access\nSocial | OIDC | API Keys"]
  end

  subgraph ControlPlane["Control Plane (Cloudflare)"]
    subgraph DO["Durable Objects (per session)"]
      direction LR
      SQLite[(SQLite DB)]
      WSHub[WebSocket Hub]
      EventStream[Event Stream]
      AgentOrch[Agent Orchestrator]
    end
  end

  subgraph ExecutionPlane["Execution Plane (Cloudflare)"]
    subgraph Runtimes["Per-Session Agent Runtimes"]
      IsolateAgent["Isolate Agent\nfast tools + short tasks"]
      SandboxAgent["Container Agents\nOpenCode, Codex, Claude Code"]
      WebUI[WebUI]
      IsolateTools["Node.js, git, virtual FS"]
      SandboxTools["Full Linux filesystem and shell tools"]
    end
  end

  LiteLLM["Optional external model gateway\nLiteLLM Providers / Models"]

  Clients --> Identity
  Identity --> ControlPlane
  ControlPlane --> ExecutionPlane
  ExecutionPlane --> LiteLLM

  IsolateAgent --> IsolateTools
  SandboxAgent --> SandboxTools
  SandboxAgent --> WebUI
```
