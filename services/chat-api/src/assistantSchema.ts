import { SchemaType } from "@google/generative-ai";

/**
 * JSON schema for Gemini structured output (flat shape — nested objects use JSON strings).
 */
export const assistantTurnResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    message: {
      type: SchemaType.STRING,
      description: "User-visible reply in plain language (no JSON fences).",
    },
    phase: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["clarify", "configure", "summarize", "finalize"],
      description:
        "clarify: gather intent; configure: concrete apps/props; summarize: review; finalize: ready to export JSON.",
    },
    widgetKind: {
      type: SchemaType.STRING,
      format: "enum",
      enum: [
        "none",
        "app_picker",
        "connect_account",
        "field_config",
        "workflow_summary",
        "conditional_builder",
      ],
      description:
        "Inline widget the UI should render next. Use none when free-form chat is enough.",
    },
    widgetTitle: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Short label for the widget card.",
    },
    widgetPayloadJson: {
      type: SchemaType.STRING,
      description: 'JSON object as a string, e.g. "{}" or "{\\"app\\":\\"slack\\"}".',
    },
    workflowPatchJson: {
      type: SchemaType.STRING,
      nullable: true,
      description:
        "If updating the draft, a JSON object with any of: title, trigger, steps, policies, conditions. Null if unchanged.",
    },
  },
  required: ["message", "phase", "widgetKind", "widgetPayloadJson"],
} as const;
