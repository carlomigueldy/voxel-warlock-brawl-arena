// Side-effect-only barrel for the "wave-2 juice & feel" modules. Under the
// default (no ?shell=react) path these load via index.html's static script
// tags; under ?shell=react, LegacyUiBridge dynamically imports this barrel
// once on mount so ui=legacy gets identical behavior either way.
import "../screens.js";
import "../draft-juice.js";
import "../nav-feel.js";
import "../onboarding.js";
import "../gamepad.js";
import "../credits.js";
