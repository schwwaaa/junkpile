# Standalone application direction

Junkpile is a transparent research and teaching layer for building standalone creative software.

The long-term value is not one giant application. It is the ability to reuse proven architectural patterns while keeping individual tools focused.

```text
Junkpile examples
      ↓
proven patterns and contracts
      ↓
focused standalone applications
```

Useful reusable areas include:

- renderer ownership
- media input
- audio analysis
- parameter/control registries
- feedback/history systems
- recording/export
- preview/output routing
- platform texture sharing
- runtime configuration and state

Applications should be able to opt into the capabilities they need without inheriting every transport, dependency, or UI convention.
