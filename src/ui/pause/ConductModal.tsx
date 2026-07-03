// One-time Code-of-Conduct disclaimer — port of index.html's #conduct-modal
// (design §9a Wave-2 / issue #166). Controlled by PauseMenu.tsx, which owns
// BOTH triggers legacy ui.js has: auto-show once per `vwb-social-conduct-v1`
// (on first game entry) and the "Re-read the Code" button inside
// SocialSettingsModal — see PauseMenu.tsx's header for why a single owner
// keeps those two triggers from fighting each other across sibling trees.
import { Modal, Button } from "../common";
import styles from "./Social.module.css";

export interface ConductModalProps {
  open: boolean;
  onDismiss: () => void;
}

export function ConductModal({ open, onDismiss }: ConductModalProps) {
  return (
    <Modal
      open={open}
      onClose={onDismiss}
      ariaLabel="The Warlock's Code"
      closeOnBackdrop={false}
      showCloseButton={false}
      className={styles.dialog}
    >
      <h2 className={styles.title}>The Warlock&rsquo;s Code</h2>
      <div className={styles.conductBody}>
        <p>Every warlock stepped into this arena to play. Keep it that way.</p>
        <ul>
          <li>
            <strong>Respect everyone.</strong> No racism, hate speech, slurs, or harassment — ever. There&rsquo;s no
            version of this that&rsquo;s a joke.
          </li>
          <li>
            <strong>Taunt, don&rsquo;t trash-talk.</strong> Playful jabs, cocky banter, and a little smack talk are
            part of the fun. Cruelty, personal attacks, and toxic pile-ons are not.
          </li>
          <li>
            <strong>Put the aggression in your spells, not your words.</strong> Play hard, aim to win, keep it clean.
          </li>
          <li>
            <strong>Win with grace, lose with grit.</strong> Be the opponent you&rsquo;d actually want to queue into
            — both directions.
          </li>
        </ul>
        <p>
          Voice and chat are a shared arena. You can <strong>mute anyone, anytime</strong> — it&rsquo;s instant,
          private, and they&rsquo;re never told. Break the Code and the arena isn&rsquo;t for you.
        </p>
      </div>
      <Button variant="forge" className={styles.conductEnter} onClick={onDismiss}>
        Enter the Arena
      </Button>
    </Modal>
  );
}
