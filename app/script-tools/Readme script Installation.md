# 🚀 Windows Quick Installer – AxEin

This repository ships with a **PowerShell installer** that makes setting up AxEin on Windows smooth and automated.

---

## 1. Install & Run

Open **PowerShell as Administrator** and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\installation-script.ps.ps1
```

The installer will:

- ✅ Enable **WSL2 / Hyper-V** features (if supported)
- ✅ Install dependencies via `winget` (**Git**, **Docker Desktop**)
- ✅ Configure WSL to use **version 2** by default
- ✅ Clone or update this repository to `C:\AxEin`
- ✅ Start the stack (`docker compose up -d`)
- ✅ Add a helper command `axein` to your PATH
- ✅ Create Desktop & Start Menu shortcuts:
  - Start AxEin
  - Stop AxEin
  - View Logs
- ✅ Register scheduled tasks:
  - **Auto-start** at user logon
  - **Nightly update** at `03:30` local time
- ✅ Run a health check at [http://localhost:3000](http://localhost:3000)
- ✅ Capture DB container logs (`axein-db-1`) if startup fails

---

## 2. After Installation

Open the app in your browser:

```
http://localhost:3000
```

Handy commands:

```powershell
axein status   # Show container status
axein logs     # View app logs
axein open     # Open app in browser
axein doctor   # Run diagnostics
```

---

## 3. Troubleshooting

- **Docker not starting?**  
  Go to **Docker Desktop → Settings → General** → enable **“Use the WSL 2 based engine”** → Apply & Restart.

- **Database container (`axein-db-1`) failed?**  
  Logs are saved to:
  ```
  C:\AxEin\logs\db-error.log
  ```
  The installer will prompt to reset the DB volume (**⚠ this deletes all existing DB data**).

- **PATH not updated right away?**  
  Open a **new PowerShell window** after installation.

- **Full installation logs:**  
  Stored in:
  ```
  C:\AxEin\logs\install-YYYYMMDD-HHMMSS.log
  ```

---

✅ With this script, you’ll be up and running in just a few minutes on Windows.
