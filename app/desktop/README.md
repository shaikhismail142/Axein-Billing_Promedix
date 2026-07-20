# AxEin Billing Desktop

The Windows and macOS applications are a secure Electron shell around the same
Dockerized AxEin web application. Browser and desktop access therefore use the
same PostgreSQL data and the same application image.

## Requirements

- Windows 10/11 64-bit or macOS 12+
- Docker Desktop installed and running
- Internet access for the first image download

The desktop app creates an `axein-desktop` Compose project with persistent named
volumes. Services use `restart: unless-stopped`, and the desktop launcher is set
to open at login so the local app is restored after a restart.

## Local packaging

```bash
cd app/desktop
npm ci
npm run dist:win
npm run dist:mac
```

Windows packages must be built on Windows and macOS packages on macOS. The
release workflow performs both builds automatically.
