const PACKAGE_NAME = "dsh-plugin-qr-connect";
const name = "qr-connect-invariant";
const inject = ["invariants"];
const install = () => {};
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));

export { apply, inject, name };
