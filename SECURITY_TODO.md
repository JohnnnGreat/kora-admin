# Deployment security hardening — open items

Captured after getting CI/CD deploy working end-to-end
(`.github/workflows/backend.yml`, push → verify → publish → deploy all
green). None of these block deploys today; they reduce blast radius if a
credential ever leaks. Tackle in order.

## 1. Stop deploying as root (highest priority)

`DEPLOY_USER` is currently `root`, so `DEPLOY_SSH_PRIVATE_KEY` is a full
root key to the VPS. Create a dedicated deploy user instead:

```bash
adduser --disabled-password --gecos "" kora-deploy
usermod -aG docker kora-deploy
mkdir -p /home/kora-deploy/.ssh
cp ~/.ssh/authorized_keys /home/kora-deploy/.ssh/authorized_keys   # move the kora_admin_deploy.pub entry here
chown -R kora-deploy:kora-deploy /home/kora-deploy/.ssh
chmod 700 /home/kora-deploy/.ssh && chmod 600 /home/kora-deploy/.ssh/authorized_keys
chown -R kora-deploy:kora-deploy /opt/emrc-admin-backend
```

Then remove that key from `root`'s `authorized_keys`, and update the
`DEPLOY_USER` GitHub secret to `kora-deploy`.

Note: membership in the `docker` group is still effectively root-equivalent
on the host (anyone who can run arbitrary containers can mount the host
filesystem) — this step removes direct shell/system-level root and access
to unrelated services on the box, not every privilege.

## 2. Restrict SSH after step 1 is confirmed working

In `/etc/ssh/sshd_config` on the VPS:

```
PermitRootLogin no
PasswordAuthentication no
```

`systemctl restart sshd`. Do this only after confirming key-based login
works for the new `kora-deploy` user — otherwise it's easy to lock
yourself out.

## 3. Firewall — only expose what's needed

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

Port `3006` never needs to be open publicly — the container already only
binds `127.0.0.1:3006`; nginx is the only thing that should reach it
externally.

## 4. Require review before deploy runs

GitHub repo → **Settings → Environments → production** → add a required
reviewer. A push to `main` still builds and publishes images
automatically, but someone has to approve before the deploy job touches
the VPS.

## 5. Token hygiene

- `GHCR_PULL_TOKEN` (classic PAT, `read:packages` only) has an expiration
  set when it was created — when it lapses, deploys fail with an auth
  error; that's the cue to rotate it.
- Remove the three leftover secrets this backend doesn't actually read
  (correct values, just unused — reads config from the VPS's `.env` file,
  not GitHub secrets):
  ```cmd
  gh secret delete DATABASE_URL --repo JohnnnGreat/kora-admin
  gh secret delete DOCKER_DATABASE_URL --repo JohnnnGreat/kora-admin
  gh secret delete PORT --repo JohnnnGreat/kora-admin
  ```

## 6. Lock down the VPS `.env` file

```bash
chmod 600 /opt/emrc-admin-backend/.env
```

Only the deploy user (or root) should be able to read it — it holds
`DATABASE_URL`, `EMAIL_UNSUBSCRIBE_SECRET`, `RESEND_WEBHOOK_SECRET`, etc.

## Also still open (unrelated to security, tracked here for convenience)

- Point `admin.raven-emrc.com`'s DNS A record at `31.97.56.29`.
- nginx + certbot on the VPS per the README's "Exposing it on a domain"
  section.
- Confirm `https://admin.raven-emrc.com/api/health/live` once DNS + nginx
  are live.
