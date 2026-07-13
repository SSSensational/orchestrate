import { describe, expect, it } from "vitest";

import {
  validateWorkflowIrL1,
  validateWorkflowIrL2,
  workflowValidationErrorSchema,
} from "../shared/src/index.js";
import {
  codexAgentRegistry,
  singleAgentCrossAgentReviewIr,
} from "../examples/src/index.js";

type WorkflowIr = Parameters<typeof validateWorkflowIrL2>[0];

const cloneIr = (): WorkflowIr => structuredClone(singleAgentCrossAgentReviewIr);
const cloneNode = (id: string, prompt = "Review the target") => ({
  ...structuredClone(singleAgentCrossAgentReviewIr.nodes[0]),
  id,
  prompt,
});

const expectStructuredFailure = (result: {
  success: boolean;
  errors: unknown[];
}) => {
  expect(result.success).toBe(false);
  expect(result.errors).not.toHaveLength(0);

  return result.errors.map((rawError) => {
    expect(Object.keys(rawError as object).sort()).toEqual(
      ["node", "edge", "code", "message"].sort(),
    );
    const error = workflowValidationErrorSchema.parse(rawError);
    expect(error.code.trim()).not.toBe("");
    expect(error.message.trim()).not.toBe("");
    return error;
  });
};

describe("workflow IR acceptance", () => {
  it("#24 accepts the bundled example at L1 without changing it", () => {
    expect(validateWorkflowIrL1(singleAgentCrossAgentReviewIr)).toEqual({
      success: true,
      data: singleAgentCrossAgentReviewIr,
      errors: [],
    });
  });

  it("#24 rejects an unknown node field with a structured node error", () => {
    const ir = cloneIr();
    Object.assign(ir.nodes[0], { unexpected: true });

    const errors = expectStructuredFailure(validateWorkflowIrL1(ir));

    expect(errors).toContainEqual(
      expect.objectContaining({
        node: "codex_review",
        edge: null,
        code: "l1.unrecognized_keys",
      }),
    );
  });

  it("#25 accepts the bundled example and a transitive upstream artifact reference", () => {
    expect(
      validateWorkflowIrL2(singleAgentCrossAgentReviewIr, codexAgentRegistry),
    ).toMatchObject({ success: true, errors: [] });

    const ir = cloneIr();
    ir.nodes.push(
      cloneNode("middle"),
      cloneNode(
        "consumer",
        "Use {{nodes.codex_review.artifacts.report}} in the final review",
      ),
    );
    ir.edges.push(
      { from: "codex_review", to: "middle" },
      { from: "middle", to: "consumer" },
    );

    expect(validateWorkflowIrL1(ir).success).toBe(true);
    expect(validateWorkflowIrL2(ir, codexAgentRegistry)).toMatchObject({
      success: true,
      errors: [],
    });
  });

  it.each([
    {
      name: "a duplicate node id",
      code: "l2.duplicate_node_id",
      locator: { node: "codex_review", edge: null },
      makeIr: () => {
        const ir = cloneIr();
        ir.nodes.push(cloneNode("codex_review"));
        return ir;
      },
    },
    {
      name: "a dangling edge",
      code: "l2.edge_endpoint_missing",
      locator: {
        node: null,
        edge: { from: "codex_review", to: "missing" },
      },
      makeIr: () => {
        const ir = cloneIr();
        ir.edges.push({ from: "codex_review", to: "missing" });
        return ir;
      },
    },
    {
      name: "an unreachable node",
      code: "l2.unreachable_node",
      locator: { node: "island", edge: null },
      makeIr: () => {
        const ir = cloneIr();
        ir.nodes.push(cloneNode("island"));
        ir.edges.push({ from: "island", to: "island" });
        return ir;
      },
    },
    {
      name: "an unresolved artifact template",
      code: "l2.unresolved_template_reference",
      locator: { node: "consumer", edge: null },
      messageFragment: "{{nodes.codex_review.artifacts.missing}}",
      makeIr: () => {
        const ir = cloneIr();
        ir.nodes.push(
          cloneNode(
            "consumer",
            "Use {{nodes.codex_review.artifacts.missing}} in the review",
          ),
        );
        ir.edges.push({ from: "codex_review", to: "consumer" });
        return ir;
      },
    },
    {
      name: "an unregistered agent",
      code: "l2.agent_not_found",
      locator: { node: "codex_review", edge: null },
      messageFragment: "missing-agent",
      makeIr: () => {
        const ir = cloneIr();
        Object.assign(ir.nodes[0], { agent: "missing-agent" });
        return ir;
      },
    },
    {
      name: "a missing agent capability",
      code: "l2.missing_capability",
      locator: { node: "codex_review", edge: null },
      messageFragment: "sandbox",
      makeIr: cloneIr,
      makeRegistry: () => {
        const registry = structuredClone(codexAgentRegistry);
        registry.codex.sandbox = false;
        return registry;
      },
    },
  ])("#25 rejects $name with a stable code and locator", (testCase) => {
    const ir = testCase.makeIr();
    const registry =
      "makeRegistry" in testCase
        ? testCase.makeRegistry()
        : codexAgentRegistry;
    expect(validateWorkflowIrL1(ir).success).toBe(true);

    const errors = expectStructuredFailure(
      validateWorkflowIrL2(ir, registry),
    );
    const error = errors.find(({ code }) => code === testCase.code);

    expect(error).toMatchObject(testCase.locator);
    if (testCase.messageFragment) {
      expect(error?.message).toContain(testCase.messageFragment);
    }
  });

  it("#25 returns deeply equal errors in the same order for repeated validation", () => {
    const ir = cloneIr();
    ir.nodes.push(
      cloneNode("codex_review"),
      cloneNode("island"),
      cloneNode(
        "consumer",
        "Use {{nodes.codex_review.artifacts.missing}} in the review",
      ),
    );
    ir.edges.push(
      { from: "codex_review", to: "missing" },
      { from: "island", to: "island" },
      { from: "codex_review", to: "consumer" },
    );

    expect(validateWorkflowIrL1(ir).success).toBe(true);
    const first = validateWorkflowIrL2(ir, codexAgentRegistry);
    const second = validateWorkflowIrL2(ir, codexAgentRegistry);
    expectStructuredFailure(first);
    expectStructuredFailure(second);
    expect(first.errors.length).toBeGreaterThan(1);
    expect(second.errors).toEqual(first.errors);
  });
});
