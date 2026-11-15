import { buildApp } from "./http/app.ts";
import { buildContainer } from "./container.ts";

const app = buildApp(buildContainer());
await app.listen({ port: Number(process.env.PORT ?? 8080), host: "0.0.0.0" });
