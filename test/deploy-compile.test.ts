import { describe, expect, it } from "vitest";
import { compileMockB20 } from "../scripts/deploy-mock-b20";

describe("deploy-mock-b20 (compile only)", () => {
  it("compiles MockB20 with solc and produces deployable bytecode + ABI", () => {
    const { abi, bytecode } = compileMockB20();
    expect(bytecode.length).toBeGreaterThan(100);
    expect(bytecode.startsWith("0x")).toBe(true);
    const names = (abi as { name: string; type: string }[]).map((e) => `${e.type}:${e.name}`);
    expect(names).toContain("function:mint");
    expect(names).toContain("function:transfer");
    expect(names).toContain("function:approve");
    expect(names).toContain("function:transferFrom");
    expect(names).toContain("constructor:undefined");
  });
});
