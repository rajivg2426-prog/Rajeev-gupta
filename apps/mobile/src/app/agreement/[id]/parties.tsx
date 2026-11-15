import { zodResolver } from "@hookform/resolvers/zod";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { useForm, type Path } from "react-hook-form";
import { Text, View } from "react-native";
import { useAddParty, useAgreement, useTemplate } from "../../../api/queries";
import type { Party, PartyRole, TemplateField, TemplatePartyRule } from "../../../api/types";
import { TemplateFieldInput } from "../../../components/TemplateFieldInput";
import { Button, Card, Choice, ErrorBox, Loading, Muted, Screen, StepHeader } from "../../../components/ui";
import { fieldsSchema, fromRaw, SUPPORTED_TYPES, toRaw, type RawSection } from "../../../forms/templateForm";

// Fallback when the template has no per-role fields.
const BASIC_FIELDS: TemplateField[] = [
  { id: "fullName", type: "text", label: "Full name", required: true },
  { id: "phone", type: "phone", label: "Mobile number", required: true },
];

function AddPartyForm({ id, rule, onDone }: { id: string; rule: TemplatePartyRule; onDone: () => void }) {
  const fields = rule.fields?.length ? rule.fields : BASIC_FIELDS;
  const schema = useMemo(() => fieldsSchema(fields), [fields]);
  const defaults = useMemo(() => Object.fromEntries(fields.filter((f) => SUPPORTED_TYPES.has(f.type)).map((f) => [f.id, toRaw(f, undefined)])), [fields]);
  const { control, handleSubmit, reset } = useForm<RawSection>({ resolver: zodResolver(schema), defaultValues: defaults });
  const add = useAddParty(id);

  const onSubmit = handleSubmit((raw) => {
    const details: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.id === "fullName" || f.id === "phone" || !SUPPORTED_TYPES.has(f.type)) continue;
      const v = fromRaw(f, raw[f.id]);
      if (v !== undefined) details[f.id] = v;
    }
    const phoneField = fields.find((f) => f.id === "phone") ?? BASIC_FIELDS[1];
    add.mutate(
      {
        role: rule.role,
        fullName: String(raw.fullName ?? "").trim(),
        phoneE164: String(fromRaw(phoneField, raw.phone) ?? ""),
        details,
      },
      {
        onSuccess: () => {
          reset(defaults);
          onDone();
        },
      },
    );
  });

  return (
    <Card>
      <Text className="text-body font-bold text-ink">Add {rule.label}</Text>
      {fields.map((f) => (
        <TemplateFieldInput<RawSection> key={f.id} field={f} name={f.id as Path<RawSection>} control={control} />
      ))}
      <ErrorBox error={add.error} />
      <Button title={`Add ${rule.label}`} onPress={onSubmit} loading={add.isPending} />
    </Card>
  );
}

function PartyRow({ p }: { p: Party }) {
  return (
    <View className="flex-row justify-between border-b border-line py-2">
      <View className="flex-1">
        <Text className="text-body text-ink">{p.fullName}</Text>
        <Text className="text-caption text-ink-muted">{p.phoneE164}</Text>
      </View>
      {p.otpRequired ? (
        <Text className={p.isVerified ? "text-success" : "text-ink-muted"}>{p.isVerified ? "Verified" : "Needs OTP"}</Text>
      ) : null}
    </View>
  );
}

export default function Parties() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const template = useTemplate();
  const agreement = useAgreement(id);
  const [role, setRole] = useState<PartyRole | "">("");

  if (template.isPending || agreement.isPending) return <Loading />;
  if (template.isError) return <ErrorBox error={template.error} onRetry={() => template.refetch()} />;
  if (agreement.isError) return <ErrorBox error={agreement.error} onRetry={() => agreement.refetch()} />;

  const rules = template.data.parties;
  const parties = agreement.data.parties;
  const countOf = (r: PartyRole) => parties.filter((p) => p.role === r).length;
  const missing = rules.filter((r) => countOf(r.role) < r.min);
  const addable = rules.filter((r) => countOf(r.role) < r.max);
  const rule = rules.find((r) => r.role === role);
  const needsOtp = parties.some((p) => p.otpRequired && !p.isVerified);
  // TODO(profile): "This is me" autofill from the saved profile.

  return (
    <Screen>
      <StepHeader step={3} title="Parties" />
      {rules.map((r) => (
        <Card key={r.role}>
          <Text className="text-body font-bold text-ink">
            {r.label} ({countOf(r.role)}/{r.max}
            {r.min > 0 ? `, at least ${r.min}` : ", optional"})
          </Text>
          {parties
            .filter((p) => p.role === r.role)
            .map((p) => (
              <PartyRow key={p.id} p={p} />
            ))}
        </Card>
      ))}
      {addable.length > 0 ? (
        <>
          <Muted>Add a party</Muted>
          <Choice options={addable.map((r) => ({ value: r.role, label: r.label }))} value={role} onChange={setRole} />
        </>
      ) : null}
      {rule ? <AddPartyForm key={rule.role} id={id} rule={rule} onDone={() => setRole("")} /> : null}
      {missing.length > 0 ? <Muted>Still needed: {missing.map((r) => r.label).join(", ")}</Muted> : null}
      <Button
        title={needsOtp ? "Continue to tenant verification" : "Continue to preview"}
        disabled={missing.length > 0}
        onPress={() => router.push(needsOtp ? `/agreement/${id}/verify` : `/agreement/${id}/preview`)}
      />
    </Screen>
  );
}
