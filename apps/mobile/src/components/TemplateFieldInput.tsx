import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";
import { View } from "react-native";
import { rupeesToPaise, rupeesInWords } from "../api/money";
import type { TemplateField } from "../api/types";
import { SUPPORTED_TYPES, type RawValue } from "../forms/templateForm";
import { Field, IconInput, MoneyInput, PhoneInput, PincodeInput, Stepper, SuffixInput, TextField } from "./inputs";
import { Text } from "./Text";
import { PillChoice, Segmented, SwitchRow } from "./ui";

/** Bounded whole numbers small enough for a − / + stepper (term, notice, lock-in, due day). */
function stepperRange(f: TemplateField): { min: number; max: number } | null {
  const { min, max } = f.validation ?? {};
  if (f.type !== "number" || min === undefined || max === undefined || max - min > 31) return null;
  return { min, max };
}

/** Fields narrow enough to sit two to a row. */
export function isCompactField(f: TemplateField): boolean {
  return f.type === "date" || f.type === "percent" || !!stepperRange(f);
}

/** Template labels carry the unit ("Monthly rent (₹)"); the input shows it instead. */
function cleanLabel(f: TemplateField): string {
  if (f.type === "money") return f.label.replace(/\s*\(₹\)\s*$/, "");
  if (f.type === "percent") return f.label.replace(/\s*\(%\)\s*$/, "");
  return f.label;
}

const asString = (raw: RawValue | undefined) => (typeof raw === "string" ? raw : "");

/** Renders one template field bound to react-hook-form at `name`. */
export function TemplateFieldInput<T extends FieldValues>({
  field: f,
  name,
  control,
  readOnly,
}: {
  field: TemplateField;
  name: Path<T>;
  control: Control<T>;
  readOnly?: boolean;
}) {
  const label = cleanLabel(f);
  if (!SUPPORTED_TYPES.has(f.type)) {
    // TODO(form): support `${f.type}` fields (e.g. the fixtures repeater).
    return (
      <View className="min-h-touch px-4 py-3 rounded-md bg-surface border border-line">
        <Text className="text-body font-medium text-ink">{label}</Text>
        <Text className="text-label text-ink-2">Not available in this version yet</Text>
      </View>
    );
  }
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange, onBlur }, fieldState: { error } }) => {
        const raw = value as RawValue | undefined;
        const s = asString(raw);
        const invalid = !!error;
        const common = { onBlur, editable: !readOnly, invalid };

        if (f.type === "checkbox") {
          return <SwitchRow label={label} hint={f.hint} value={raw === true} onChange={onChange} />;
        }

        let input;
        let hint: string | undefined = f.hint;
        const range = stepperRange(f);
        if ((f.type === "select" || f.type === "radio") && f.options) {
          input =
            f.type === "radio" && f.options.length <= 3 ? (
              <Segmented options={f.options} value={s} onChange={onChange} />
            ) : (
              <PillChoice options={f.options} value={s} onChange={onChange} />
            );
        } else if (f.type === "money") {
          const paise = rupeesToPaise(s);
          hint = (paise !== null && rupeesInWords(paise / 100)) || f.hint;
          input = <MoneyInput {...common} value={s} onChangeText={onChange} />;
        } else if (f.type === "phone") {
          input = <PhoneInput {...common} value={s.replace(/^\+91/, "")} onChangeText={onChange} placeholder="10-digit mobile" />;
        } else if (f.type === "pincode") {
          input = <PincodeInput {...common} value={s} onChangeText={onChange} />;
        } else if (range) {
          input = <Stepper label={label} value={s} onChange={onChange} min={range.min} max={range.max} invalid={invalid} />;
        } else if (f.type === "percent") {
          input = <SuffixInput {...common} suffix="%" value={s} onChangeText={onChange} keyboardType="decimal-pad" />;
        } else if (f.type === "date") {
          // TODO(form): native date picker; typed ISO date for now.
          input = <IconInput {...common} icon="calendar" value={s} onChangeText={onChange} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />;
        } else {
          const multiline = f.type === "textarea" || f.type === "address";
          input = (
            <TextField
              {...common}
              value={s}
              onChangeText={onChange}
              multiline={multiline}
              keyboardType={f.type === "number" || f.type === "aadhaarLast4" ? "number-pad" : f.type === "email" ? "email-address" : "default"}
              maxLength={f.type === "aadhaarLast4" ? 4 : undefined}
              autoCapitalize={f.type === "pan" ? "characters" : f.type === "email" ? "none" : f.type === "text" || multiline ? "words" : "sentences"}
            />
          );
        }
        return (
          <Field label={label} hint={hint} error={error?.message}>
            {input}
          </Field>
        );
      }}
    />
  );
}
