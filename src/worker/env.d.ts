// Secrets uploaded with `wrangler secret put` are not declared in
// wrangler.jsonc, so `wrangler types` cannot see them. Declaration merging
// adds them to the generated Env interface.
interface Env {
    CONTROL_TOKEN: string;
}
