import type { Config } from "@netlify/functions";
import { handle } from "../../server/app";
import { netlifyDb } from "../../server/db-netlify";

export default async (req: Request) =>
  handle(req, {
    db: netlifyDb(),
    env: { SESSION_SECRET: process.env.SESSION_SECRET ?? "", SETUP_TOKEN: process.env.SETUP_TOKEN || undefined },
    now: () => new Date(),
  });

export const config: Config = { path: "/api/*" };
