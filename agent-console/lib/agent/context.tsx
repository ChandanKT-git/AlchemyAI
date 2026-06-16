"use client";

// ─────────────────────────────────────────────────────────────
// Agent Context — React Context Provider for Layer 1 + Layer 2
//
// This wires the WSClient (connection layer) to the agentReducer
// (stream/tool layer) and exposes the resulting state to the
// entire component tree via React Context.
//
// WHY A CONTEXT PROVIDER?
// Without it, AppShell would need to pass state as props through
// every level of the tree (prop drilling). With context, any
// component can access agent state directly:
//
//   const { state, sendMessage } = useAgent();
//
// WHAT IT OWNS:
// - Creates and manages the WSClient instance
// - Feeds parsed messages through agentReducer
// - Exposes: agentState, connectionState, sendMessage, sendToolAck
// ─────────────────────────────────────────────────────────────

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { WSClient, type ConnectionState } from "@/lib/protocol/ws-client";
import type { AgentState } from "@/lib/agent/types";
import {
  agentReducer,
  createInitialState,
  resetForNewTurn,
  clearPendingAcks,
} from "@/lib/agent/reducer";
import type { ServerMessage } from "@/lib/protocol/types";

// ── Context Shape ────────────────────────────────────────────

interface AgentContextValue {
  /** The current agent state (stream, context, timeline) */
  state: AgentState;

  /** The current WebSocket connection state */
  connectionState: ConnectionState;

  /** Send a user message (resets stream for new turn) */
  sendMessage: (content: string) => void;

  /** Send a TOOL_ACK for a tool call */
  sendToolAck: (callId: string) => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────

interface AgentProviderProps {
  url: string;
  children: ReactNode;
}

export function AgentProvider({ url, children }: AgentProviderProps) {
  // We use useState for both agentState and connectionState so
  // React re-renders when they change.
  const [agentState, setAgentState] = useState<AgentState>(createInitialState);
  const [connectionState, setConnectionState] = useState<ConnectionState>("IDLE");

  // Use a ref for the WSClient so it persists across renders
  const clientRef = useRef<WSClient | null>(null);

  // We use a ref for the state so the handleMessage callback
  // always has the latest state without needing to be recreated.
  const stateRef = useRef<AgentState>(agentState);
  stateRef.current = agentState;

  // ── Message handler ─────────────────────────────────
  const handleMessage = useCallback((msg: ServerMessage) => {
    setAgentState((prev) => agentReducer(prev, msg));
  }, []);

  // ── Initialize WSClient on mount ────────────────────
  useEffect(() => {
    const client = new WSClient({
      url,
      onMessage: handleMessage,
      onStateChange: setConnectionState,
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [url, handleMessage]);

  // ── Send TOOL_ACKs when the reducer queues them ──────
  // This useEffect fires after the reducer adds call_ids
  // to pendingAcks. We send TOOL_ACK for each, then clear.
  //
  // WHY useEffect and not in handleMessage?
  // The reducer is pure — it can't do side effects.
  // useEffect runs AFTER React commits the state update,
  // which means the tool card is already in the DOM when
  // we send ACK. This matches the protocol requirement:
  // "ACK means I've processed and rendered this tool call."
  useEffect(() => {
    if (agentState.pendingAcks.length === 0) return;
    if (!clientRef.current) return;

    for (const callId of agentState.pendingAcks) {
      console.log(`[AgentProvider] Sending TOOL_ACK for ${callId}`);
      clientRef.current.send({ type: "TOOL_ACK", call_id: callId });
    }

    // Clear the queue so we don't send again
    setAgentState((prev) => clearPendingAcks(prev));
  }, [agentState.pendingAcks]);

  // ── Actions ─────────────────────────────────────────

  const sendMessage = useCallback((content: string) => {
    if (!clientRef.current) return;

    // Reset agent state for new turn (preserves context)
    setAgentState((prev) => resetForNewTurn(prev));

    // Send via WebSocket (also resets reorder buffer)
    clientRef.current.sendUserMessage(content);
  }, []);

  const sendToolAck = useCallback((callId: string) => {
    if (!clientRef.current) return;
    clientRef.current.send({ type: "TOOL_ACK", call_id: callId });
  }, []);

  // ── Context value (stable reference) ────────────────

  const value: AgentContextValue = {
    state: agentState,
    connectionState,
    sendMessage,
    sendToolAck,
  };

  return (
    <AgentContext.Provider value={value}>
      {children}
    </AgentContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────

/**
 * Access the agent state and actions from any component.
 * Must be used inside an <AgentProvider>.
 */
export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) {
    throw new Error("useAgent must be used within an <AgentProvider>");
  }
  return ctx;
}
