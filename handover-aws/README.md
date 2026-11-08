# Shift Handover: AWS version (simple)

One small server on one EC2 machine. No database to install, no npm install.
Everyone opens the same address in their browser and sees the same live list.

Think of it as: the **server.js** is the notice board owner, **data/handover.json** is the board itself,
and the **web page** is just the window people look through.

## What you need
- One small EC2 instance (Amazon Linux, t3.micro is enough for a team)
- Node.js 18 or newer on it (`sudo dnf install -y nodejs`, then check `node -v`)
- Approval from your security team before real Acxiom data goes in

## Set up (about 15 minutes)

1. **Launch the EC2 instance** in your company network. In the security group, allow port 3000 only from your company IP range or VPN. Do not open it to the whole internet.
2. **Copy this folder** to the machine:
   `scp -r handover-aws ec2-user@<machine-ip>:~/`
3. **Test it first** (on the machine):
   `cd ~/handover-aws`
   `HANDOVER_USER=team HANDOVER_PASS=pick-a-password node server.js`
   Open `http://<machine-ip>:3000` in your browser, log in, and add a dummy item.
   The badge near the title should say "Shared · live".
4. **Keep it running forever** with systemd:
   - Open `handover.service` and change the password (and the folder path if yours differs).
   - `sudo cp handover.service /etc/systemd/system/`
   - `sudo systemctl enable --now handover`
   - Check with `sudo systemctl status handover`
5. **Share the address** with your team (same login for everyone for now).

## Where the data lives
- Main file: `data/handover.json`
- Daily backups: `data/backups/` (keeps the last 14 days automatically)
- Retention runs by itself: P1/P2/P3 items are deleted after their set days (default 365/90/30), chat after 24 hours. You can change the days on the page.
- Extra safety (optional): add this line to `crontab -e` to copy backups to S3 nightly:
  `0 3 * * * aws s3 sync /home/ec2-user/handover-aws/data/backups s3://YOUR-BUCKET/handover-backups`
  (the machine needs an IAM role that can write to that bucket)

## Worked examples

**A teammate can't open the page:** check the security group allows their IP on port 3000, then check `sudo systemctl status handover`.

**You want to move to a new machine:** stop the service, copy the `data` folder to the new machine's `handover-aws` folder, start the service. Everything comes with it.

**You forgot the password:** edit `handover.service`, run `sudo systemctl daemon-reload && sudo systemctl restart handover`.

## Honest limits (read before going live)
- **Login is basic.** One shared username and password. Over plain http the password travels unencrypted, so keep this on your private network or VPN only. For real use, put an Application Load Balancer with a certificate (HTTPS) in front, or ask your cloud team to.
- Names in Owner and Chat come from a dropdown, so they are not verified per person. Proper per-person login (SSO) is the next step.
- One server means one point of failure. The backups protect the data, not the uptime.
- ServiceNow auto-fill is not included. That is a separate step once you have API access.
