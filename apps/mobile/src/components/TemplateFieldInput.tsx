import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";
import { Text } from "react-native";
import type { TemplateField } from "../api/types";
import { SUPPORTED_TYPES, type RawValue } from "../forms/templateForm";
import { Checkbox, Choice, Field, Input } from "./ui";

const KEYBOARD: Partial<Record<TemplateField["type"], "numeric" | "decimal-pad" | "phone-pad" | "email-address">> = {
  number: "numeric",
  percent: "decimal-pad",
  money: "decimal-pad",
  phone: "phone-pad",
  pincode: "numeric",
  aadhaarLast4: "numeric",
  email: "email-address",
};

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
  if (!SUPPORTED_TYPES.has(f.type)) {
    // TODO(form): support `${f.type}` fields.
    return <Text className="text-caption text-ink-muted">{f.label}: not supported in this build yet</Text>;
  }
  const label = f.required ? `${f.label} *` : f.label;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange, onBlur }, fieldState: { error } }) => {
        const raw = value as RawValue | undefined;
        if (f.type === "checkbox") {
          return <Checkbox label={f.label} value={raw === true} onChange={onChange} />;
        }
        let input;
        if ((f.type === "select" || f.type === "radio") && f.options) {
          input = <Choice options={f.options} value={typeof raw === "string" ? raw : ""} onChange={onChange} />;
        } else {
          const multiline = f.type === "textarea" || f.type === "address";
          input = (
            <Input
              value={typeof raw === "string" ? raw : ""}
              onChangeText={onChange}
              onBlur={onBlur}
              editable={!readOnly}
              invalid={!!error}
              multiline={multiline}
              numberOfLines={multiline ? 3 : 1}
              keyboardType={KEYBOARD[f.type] ?? "default"}
              autoCapitalize={f.type === "pan" ? "characters" : f.type === "email" ? "none" : "sentences"}
              // TODO(form): native date picker; plain text for now.
              placeholder={f.type === "date" ? "YYYY-MM-DD" : f.type === "money" ? "Amount in ₹" : f.type === "phone" ? "10-digit mobile" : undefined}
              className={multiline ? "min-h-20" : undefined}
            />
          );
        }
        return (
          <Field label={label} hint={f.hint} error={error?.message}>
            {input}
          </Field>
        );
      }}
    />
  );
}
