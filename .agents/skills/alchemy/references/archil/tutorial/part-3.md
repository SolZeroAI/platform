<!-- source: https://alchemy.run/archil/tutorial/part-3
     upstream: website/src/content/docs/archil/tutorial/part-3.mdx
     alchemy 2.0.0-beta.86 @ 21c6012 -->

# Part 3: A Fork per User

> Give each user an Archil fork of the set-up sandbox, found again by name, which keeps their changes.

## Fork Golden for a user

```diff lang="typescript"
// src/Api.ts
+    const userSandbox = Effect.fn("userSandbox")(function* (user: string) {
+      return (yield* sandboxes.get(`user-${user}`)) ?? (yield* sandboxes.create({ name: `user-${user}` }));
+    });
```

A user's first request forks `Golden`, with the repository already cloned. The fork is named after the user, so `sandboxes.get` finds it again on their next request.

## Their changes stay in their fork

```diff lang="typescript"
// src/Api.ts
+        const match = /^\/users\/([a-z0-9-]+)\/files\/(.+)$/.exec(url.pathname);
+        if (match !== null) {
+          const sandbox = yield* userSandbox(match[1]!);
+          const path = `/work/is/${match[2]}`;
+          if (request.method === "PUT") yield* sandbox.files.write(path, yield* request.text);
+          return yield* HttpServerResponse.json({ content: yield* sandbox.files.readText(path) });
+        }
```

Each user edits their own copy of the repository. `Golden` never changes, so the next fork doesn't see their edits. A fork pauses when it's idle, keeping its memory, and resumes on the user's next request.

<PackageManagers
  script={`{run} alchemy deploy
curl -X PUT "$URL/users/ana/files/notes.md" -d 'hello'
curl "$URL/users/ana/files/notes.md"`}
/>

## Delete a user's fork

```diff lang="typescript"
// src/Api.ts
+        const user = /^\/users\/([a-z0-9-]+)$/.exec(url.pathname)?.[1];
+        if (request.method === "DELETE" && user !== undefined) {
+          yield* sandboxes.delete(`user-${user}`);
+          return HttpServerResponse.empty({ status: 204 });
+        }
```

Forks the program creates carry its name prefix and aren't deleted with the Stack, so delete them when their owner goes away.

## Next

[Part 4](/archil/tutorial/part-4) changes the sandbox.
