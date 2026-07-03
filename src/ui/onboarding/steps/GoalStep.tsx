// Step 3 — goal/rules primer. Static content, verbatim port of index.html's
// onboarding-step[data-step="2"] goal cards.
import styles from "../Onboarding.module.css";

const GOALS: { icon: string; title: string; body: string }[] = [
  { icon: "🛡", title: "Survive", body: "There are no health bars — every hit adds charge, not damage." },
  { icon: "💥", title: "Knock rivals off", body: "Charge builds knockback — launch foes off the shrinking arena." },
  { icon: "🔮", title: "Use your spells", body: "Six equipped spells, one always Fireball — cast wisely." },
];

export function GoalStep() {
  return (
    <section className={styles.step} aria-label="Know the arena">
      <h3 className={styles.stepTitle}>Know the arena</h3>
      <p className={styles.stepDesc}>Last warlock standing wins the round. First to 5 round wins takes the match.</p>
      <div className={styles.goalCards}>
        {GOALS.map((g) => (
          <div key={g.title} className={styles.goalCard}>
            <span className={styles.goalIcon} aria-hidden="true">
              {g.icon}
            </span>
            <h4>{g.title}</h4>
            <p>{g.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
