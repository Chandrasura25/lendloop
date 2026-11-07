import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { drill, isoDate, setup, signIn } from "./helpers";

describe("roles", () => {
  test("new users are plain users; only a verified ADMIN_EMAILS address becomes admin", async () => {
    const t = setup();
    const { as: ada } = await signIn(t, "Ada");
    expect((await ada.query(api.users.me, {}))?.role).toBe("user");

    const { as: admin } = await signIn(t, "Admin");
    expect((await admin.query(api.users.me, {}))?.role).toBe("admin");
  });

  test("an unverified email on the admin list does not grant admin", async () => {
    const t = setup();
    const { as } = await signIn(t, "Admin", { emailVerified: false });
    expect((await as.query(api.users.me, {}))?.role).toBe("user");
  });

  test("signed-out callers can't write", async () => {
    const t = setup();
    await expect(t.mutation(api.tools.create, drill)).rejects.toThrow(/sign in/);
    await expect(t.mutation(api.users.store, {})).rejects.toThrow(/sign in/);
  });

  test("me never exposes email or token identifier", async () => {
    const t = setup();
    const { as } = await signIn(t, "Ada");
    const me = await as.query(api.users.me, {});
    expect(Object.keys(me!).sort()).toEqual(["_id", "name", "role", "trustedLender"]);
  });
});

describe("listings", () => {
  test("users can edit and delete only their own listings", async () => {
    const t = setup();
    const { as: ada } = await signIn(t, "Ada");
    const { as: bob } = await signIn(t, "Bob");
    const toolId = await ada.mutation(api.tools.create, drill);

    await expect(bob.mutation(api.tools.update, { toolId, ...drill, name: "Mine now" })).rejects.toThrow(
      /your own listings/,
    );
    await expect(bob.mutation(api.tools.remove, { toolId })).rejects.toThrow(/your own listings/);

    await ada.mutation(api.tools.update, { toolId, ...drill, name: "Hammer drill" });
    expect((await ada.query(api.tools.mine, {}))[0].name).toBe("Hammer drill");
    await ada.mutation(api.tools.remove, { toolId });
    expect(await ada.query(api.tools.mine, {})).toHaveLength(0);
  });

  test("admins can remove any listing, but can't rewrite it", async () => {
    const t = setup();
    const { as: ada } = await signIn(t, "Ada");
    const { as: admin } = await signIn(t, "Admin");
    const toolId = await ada.mutation(api.tools.create, drill);

    await expect(admin.mutation(api.tools.update, { toolId, ...drill, name: "x" })).rejects.toThrow();
    await admin.mutation(api.tools.remove, { toolId });
    expect(await ada.query(api.tools.mine, {})).toHaveLength(0);
  });

  test("input is validated server-side", async () => {
    const t = setup();
    const { as } = await signIn(t, "Ada");
    await expect(as.mutation(api.tools.create, { ...drill, name: "   " })).rejects.toThrow(/Name is required/);
    await expect(as.mutation(api.tools.create, { ...drill, name: "x".repeat(81) })).rejects.toThrow(/80 characters/);
    // @ts-expect-error: category outside the allowed list is rejected by the validator
    await expect(as.mutation(api.tools.create, { ...drill, category: "weapons" })).rejects.toThrow();
  });

  test("the public list shows only name and category of available tools", async () => {
    const t = setup();
    const { as: ada } = await signIn(t, "Ada");
    await ada.mutation(api.tools.create, drill);
    const list = await t.query(api.tools.listPublic, {});
    expect(list).toEqual([{ name: "Cordless drill", category: "power tools" }]);
  });

  test("signed-in browse can filter by category", async () => {
    const t = setup();
    const { as: ada } = await signIn(t, "Ada");
    await ada.mutation(api.tools.create, drill);
    await ada.mutation(api.tools.create, { ...drill, name: "Tent", category: "camping" });
    const camping = await ada.query(api.tools.listAll, { category: "camping" });
    expect(camping.map((x) => x.name)).toEqual(["Tent"]);
  });
});

describe("borrowing", () => {
  async function world() {
    const t = setup();
    const ada = await signIn(t, "Ada"); // owner
    const bob = await signIn(t, "Bob"); // borrower
    const cat = await signIn(t, "Cat"); // unrelated user
    const toolId = await ada.as.mutation(api.tools.create, drill);
    return { t, ada, bob, cat, toolId };
  }
  const range = { startDate: isoDate(1), endDate: isoDate(3) };

  test("you can't borrow your own tool", async () => {
    const { ada, toolId } = await world();
    await expect(ada.as.mutation(api.loans.request, { toolId, ...range })).rejects.toThrow(/your own tool/);
  });

  test("dates are validated", async () => {
    const { bob, toolId } = await world();
    await expect(bob.as.mutation(api.loans.request, { toolId, startDate: isoDate(-1), endDate: isoDate(1) })).rejects.toThrow(/past/);
    await expect(bob.as.mutation(api.loans.request, { toolId, startDate: isoDate(3), endDate: isoDate(1) })).rejects.toThrow(/on or after/);
    await expect(bob.as.mutation(api.loans.request, { toolId, startDate: isoDate(1), endDate: isoDate(40) })).rejects.toThrow(/at most/);
    await expect(bob.as.mutation(api.loans.request, { toolId, startDate: "tomorrow", endDate: isoDate(1) })).rejects.toThrow(/YYYY-MM-DD/);
  });

  test("only the owner can approve or decline, and only the owner marks a loan returned", async () => {
    const { ada, bob, cat, toolId } = await world();
    const loanId = await bob.as.mutation(api.loans.request, { toolId, ...range });

    await expect(bob.as.mutation(api.loans.decide, { loanId, decision: "approve" })).rejects.toThrow(/owner/);
    await expect(cat.as.mutation(api.loans.decide, { loanId, decision: "approve" })).rejects.toThrow(/owner/);
    await ada.as.mutation(api.loans.decide, { loanId, decision: "approve" });
    await expect(ada.as.mutation(api.loans.decide, { loanId, decision: "decline" })).rejects.toThrow(/already approved/);

    await expect(bob.as.mutation(api.loans.markReturned, { loanId })).rejects.toThrow(/owner/);
    await ada.as.mutation(api.loans.markReturned, { loanId });
    expect((await bob.as.query(api.loans.myRequests, {}))[0].status).toBe("returned");
  });

  test("only the borrower can cancel their pending request", async () => {
    const { ada, bob, cat, toolId } = await world();
    const loanId = await bob.as.mutation(api.loans.request, { toolId, ...range });
    await expect(cat.as.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/your own requests/);
    await expect(ada.as.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/your own requests/);
    await bob.as.mutation(api.loans.cancel, { loanId });
    expect((await ada.as.query(api.loans.incoming, {}))[0].status).toBe("cancelled");
  });

  test("approving one request declines clashing ones and blocks double booking", async () => {
    const { ada, bob, cat, toolId } = await world();
    const bobLoan = await bob.as.mutation(api.loans.request, { toolId, ...range });
    const catLoan = await cat.as.mutation(api.loans.request, { toolId, startDate: isoDate(2), endDate: isoDate(4) });
    await ada.as.mutation(api.loans.decide, { loanId: bobLoan, decision: "approve" });

    const incoming = await ada.as.query(api.loans.incoming, {});
    expect(incoming.find((l) => l._id === catLoan)?.status).toBe("declined");
    await expect(cat.as.mutation(api.loans.request, { toolId, startDate: isoDate(3), endDate: isoDate(5) })).rejects.toThrow(/already booked/);
  });

  test("users only see their own requests; admin views are admin-only", async () => {
    const { bob, cat, toolId } = await world();
    await bob.as.mutation(api.loans.request, { toolId, ...range });
    expect(await cat.as.query(api.loans.myRequests, {})).toHaveLength(0);
    expect(await cat.as.query(api.loans.incoming, {})).toHaveLength(0);
    await expect(cat.as.query(api.loans.adminAll, {})).rejects.toThrow(/Only admins/);
    await expect(cat.as.query(api.users.listForAdmin, {})).rejects.toThrow(/Only admins/);
    await expect(cat.as.query(api.automation.failures, {})).rejects.toThrow(/Only admins/);
  });

  test("only admins can mark a Trusted Lender", async () => {
    const { t, ada, bob } = await world();
    const admin = await signIn(t, "Admin");
    await expect(bob.as.mutation(api.users.setTrustedLender, { userId: ada.userId, trusted: true })).rejects.toThrow(/Only admins/);
    await admin.as.mutation(api.users.setTrustedLender, { userId: ada.userId, trusted: true });
    expect((await ada.as.query(api.users.me, {}))?.trustedLender).toBe(true);
  });

  test("an owner can't delete a tool that's out on loan; open requests are cancelled on delete", async () => {
    const { t, ada, bob, cat, toolId } = await world();
    const now = await bob.as.mutation(api.loans.request, { toolId, startDate: isoDate(0), endDate: isoDate(2) });
    await ada.as.mutation(api.loans.decide, { loanId: now, decision: "approve" });
    await expect(ada.as.mutation(api.tools.remove, { toolId })).rejects.toThrow(/out on loan/);

    const toolB = await ada.as.mutation(api.tools.create, { ...drill, name: "Ladder" });
    const pending = await cat.as.mutation(api.loans.request, { toolId: toolB, ...range });
    await ada.as.mutation(api.tools.remove, { toolId: toolB });
    const loan = await t.run((ctx) => ctx.db.get(pending));
    expect(loan?.status).toBe("cancelled");
  });
});
