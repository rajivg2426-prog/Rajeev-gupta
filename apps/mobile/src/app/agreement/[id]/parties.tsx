import { zodResolver } from "@hookform/resolvers/zod";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { useForm, type Path } from "react-hook-form";
import { View } from "react-native";
import { useAddParty, useAgreement, useTemplate } from "../../../api/queries";
import type { Party, PartyRole, TemplateField, TemplatePartyRule } from "../../../api/types";
import { TemplateFieldInput } from "../../../components/TemplateFieldInput";
import { formatPhone } from "../../../components/describe";
import { AddButton, Avatar, BottomBar, Button, Caption, Card, ErrorNotice, ErrorState, Heading, Icon, Loading, Screen, SectionLabel, StepHeader, Text } from "../../../components/ui";
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
    <Card className="gap-5">
      <Text className="text-heading font-semibold text-ink">Add {rule.label.toLowerCase()}</Text>
      {fields.map((f) => (
        <TemplateFieldInput<RawSection> key={f.id} field={f} name={f.id as Path<RawSection>} control={control} />
      ))}
      <ErrorNotice error={add.error} />
      <View className="gap-2">
        <Button size="md" title={`Add ${rule.label.toLowerCase()}`} busy={add.isPending} busyLabel="Adding…" onPress={() => void onSubmit()} />
        <Button variant="text" title="Cancel" onPress={onDone} />
      </View>
    </Card>
  );
}

/** "S/o Ram Prasad Yadav · 58 years" from whatever details were entered. */
function relationLine(p: Party) {
  const d = p.details as Record<string, unknown>;
  const rel = [d.relation, d.relationName].filter(Boolean).join(" ");
  return [rel, d.age ? `${d.age} years` : ""].filter(Boolean).join(" · ");
}

function PartyCard({ p }: { p: Party }) {
  const d = p.details as Record<string, unknown>;
  const rel = relationLine(p);
  return (
    <Card>
      <View className="flex-row items-start gap-3">
        <Avatar name={p.fullName} tone={p.role === "LANDLORD" ? "primary" : "neutral"} />
        <View className="flex-1 min-w-0">
          <Text className="text-body font-semibold text-ink">{p.fullName}</Text>
          {rel ? <Text className="text-label text-ink-2">{rel}</Text> : null}
        </View>
        {p.otpRequired && p.isVerified ? <Icon name="shield" size={20} color="success" /> : null}
      </View>
      <View className="gap-1 pl-[52px]">
        <Text className="text-label text-ink-2 tabular">{formatPhone(p.phoneE164)}</Text>
        {d.aadhaarLast4 ? <Text className="text-label text-ink-2">Aadhaar ending {String(d.aadhaarLast4)}</Text> : null}
        {d.address ? <Text className="text-label text-ink-2">{String(d.address)}</Text> : null}
      </View>
      {p.otpRequired && !p.isVerified ? (
        <View className="rounded-md bg-sunken px-3 py-2 flex-row items-center gap-2">
          <Icon name="message" size={16} color="ink-3" />
          <Text className="flex-1 text-caption text-ink-2">{p.fullName.split(" ")[0]} gets a code on this number in the next step</Text>
        </View>
      ) : null}
    </Card>
  );
}

const ROLE_CAPTION: Record<string, string> = {
  LANDLORD: "Landlord · first party",
  TENANT: "Tenant · second party, pays stamp duty",
  WITNESS: "Witnesses · optional",
};

export default function Parties() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const template = useTemplate();
  const agreement = useAgreement(id);
  const [role, setRole] = useState<PartyRole | "">("");

  const header = <StepHeader step={3} label="Parties" />;
  if (template.isPending || agreement.isPending)
    return (
      <Screen header={header}>
        <Loading />
      </Screen>
    );
  if (template.isError || agreement.isError)
    return (
      <Screen header={header}>
        <ErrorState
          error={template.error ?? agreement.error}
          onRetry={() => {
            void template.refetch();
            void agreement.refetch();
          }}
        />
      </Screen>
    );

  const rules = template.data.parties;
  const parties = agreement.data.parties;
  const countOf = (r: PartyRole) => parties.filter((p) => p.role === r).length;
  const missing = rules.filter((r) => countOf(r.role) < r.min);
  const needsOtp = parties.some((p) => p.otpRequired && !p.isVerified);
  // TODO(profile): "This is me" autofill from the saved profile.

  return (
    <Screen
      header={header}
      contentClassName="gap-7"
      footer={
        <BottomBar>
          <Button
            title={needsOtp ? "Continue to verify tenant" : "Continue to preview"}
            disabled={missing.length > 0}
            onPress={() => router.push(needsOtp ? `/agreement/${id}/verify` : `/agreement/${id}/preview`)}
          />
          {missing.length > 0 ? <Caption className="text-center">Still needed: {missing.map((r) => r.label.toLowerCase()).join(", ")}</Caption> : null}
        </BottomBar>
      }
    >
      <Heading title="Who is signing?" body="Names are printed exactly as typed and must match the e-stamp certificate." />
      {rules.map((r) => {
        const list = parties.filter((p) => p.role === r.role);
        const canAdd = list.length < r.max;
        return (
          <View key={r.role} className="gap-3">
            <SectionLabel>{ROLE_CAPTION[r.role] ?? r.label}</SectionLabel>
            {list.map((p) => (
              <PartyCard key={p.id} p={p} />
            ))}
            {role === r.role ? (
              <AddPartyForm key={r.role} id={id} rule={r} onDone={() => setRole("")} />
            ) : canAdd ? (
              <AddButton
                title={list.length === 0 ? `Add ${r.label.toLowerCase()}` : `Add another ${r.label.toLowerCase()}`}
                onPress={() => setRole(r.role)}
              />
            ) : null}
            {r.role === "WITNESS" && list.length === 0 && role !== r.role ? (
              <Caption>You can also leave the witness lines blank and fill them in by hand when signing.</Caption>
            ) : null}
          </View>
        );
      })}
    </Screen>
  );
}
