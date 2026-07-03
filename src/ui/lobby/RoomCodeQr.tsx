// Room code banner + copy actions + QR invite (design doc §9's "room code,
// QR via qrcode npm" — port of ui.js's showLobby()'s room-code fill,
// _inviteLink()/_copy()/_renderQR() (src/ui.js:1418-1433, 1905-1916) and
// index.html L546-567's markup.
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { menuCue } from "../../audio.js";
import { Button } from "../common";
import styles from "./RoomCodeQr.module.css";

export interface RoomCodeQrProps {
  roomCode: string | null;
}

// Port of ui.js's _inviteLink(): the current page URL with its query
// replaced by ?room=<code>, so scanning/opening it lands straight on the
// join form pre-filled with the code (see ui.js's _prefillFromUrl()).
function inviteLink(roomCode: string): string {
  const url = new URL(location.href);
  url.search = "?room=" + roomCode;
  return url.toString();
}

// One copy button's transient "Copied!"/"Copy failed" label state — port of
// ui.js's _copy(text, btn, label): writes the clipboard, flashes a
// confirmation (with the same menuCue("copyConfirm") audio cue) or failure
// message, then reverts to the resting label after 1.4s.
function useCopyLabel(resting: string): [string, (text: string) => void] {
  const [label, setLabel] = useState(resting);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setLabel("Copied!");
      menuCue("copyConfirm");
    } catch {
      setLabel("Copy failed");
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setLabel(resting), 1400);
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return [label, copy];
}

export function RoomCodeQr({ roomCode }: RoomCodeQrProps) {
  const [copyCodeLabel, copyCode] = useCopyLabel("Copy Code");
  const [copyLinkLabel, copyLink] = useCopyLabel("Copy Invite Link");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const link = roomCode ? inviteLink(roomCode) : null;

  // Port of ui.js's _renderQR(): (re)draws the QR canvas whenever the invite
  // link changes (i.e. whenever the room code changes).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !link) return;
    let cancelled = false;
    QRCode.toCanvas(canvas, link, { width: 180, margin: 1 }).catch(() => {
      if (!cancelled) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    });
    return () => { cancelled = true; };
  }, [link]);

  return (
    <div className={styles.room}>
      <div className={styles.banner}>
        <span className={styles.bannerLabel}>Room Code</span>
        <div className={styles.code}>{roomCode || "------"}</div>
      </div>
      <div className={styles.actions}>
        <Button
          variant="ghost"
          className={styles.btnSm}
          disabled={!roomCode}
          onClick={() => roomCode && copyCode(roomCode)}
        >
          {copyCodeLabel}
        </Button>
        <Button
          variant="ghost"
          className={styles.btnSm}
          disabled={!link}
          onClick={() => link && copyLink(link)}
        >
          {copyLinkLabel}
        </Button>
        <details className={styles.qrPop}>
          <summary aria-label="Show QR code">QR</summary>
          <div className={styles.qr}>
            <canvas ref={canvasRef} />
          </div>
        </details>
      </div>
      <p className={styles.hint}>Scan the QR code or share the link to invite players.</p>
    </div>
  );
}
