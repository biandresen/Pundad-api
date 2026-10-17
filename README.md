# Joke-API
RESTful Joke API for JAMstack project (TOP)

Link to API documentation: <a href="https://documenter.getpostman.com/view/44451419/2sB2qgeJBS">Click Here</a>

Development setup and the deployment rollout: [docs/development.md](docs/development.md).

## Tests

```bash
npm test
```

The HTTP integration suite is verified with Node.js 24.12.0 and uses Node's
experimental module mocking. It runs the real Express app with database and
email provider substitutes and a controlled clock; production credentials are
not needed.
