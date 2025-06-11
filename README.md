# nudge.js
> A nudge in time saves nine

The nudge.js SDK is a lightweight (**ZERO** dependencies) wrapper around [nudge](http://nudge.pro/) and its [APIs](https://app.nudge.net/api/swagger/index.html#/).

## Getting Started

The nudge.js SDK clients come in 2 flavors:

1) The fully featured nudge.js client that exposes all API capabilities within nudge
2) The "Send" client which specifically only supports sending real-time nudges

To use the nudge.js SDK you need either [an API key](https://help.nudge.net/article/38-nudge-api-documentation) (for sending real-time nudges via the "Send" client) or the user credentials used to log into app.nudge.net (all other functionality).

> [!TIP]
> If you're not sure how to get an API key, you can read more here: [Nudge API Documentation](https://help.nudge.net/article/38-nudge-api-documentation)

In either case, getting started is the same:

```ts
import { createSendClient, createClient } from "nudge.js";

const apiKey = ""; // get this from the nudge dashboard
const sendClient = createSendClient({ apiKey });

// credentials used to login to app.nudge.net
const authCredentials = {
  email: "",
  password: "",
};
const client = createClient({ apiKey, authCredentials });
```

The clients can be used immediately for sending real-time nudges:

```ts
sendClient.send({
  nudgeId: "1234" // you can get this from the nudge dashboard,
  recipient: {
    email: "ibrahims@tilli.pro",
    name: "Ibrahim Ali", // OPTIONAL
  },
  options: { // OPTIONAL
    cc: ["michaelv@tilli.pro"] // OPTIONAL
    bcc: ["avdhoots@tilli.pro"] // OPTIONAL
  },
  mergeTags: { // OPTIONAL
    productName: "tilliX",
  },
  files: [ // OPTIONAL
    new File(["test_document_text"], "test_document.txt", { type: "text/plain" }),
  ],
})
```

That's it. Your nudge has been sent.