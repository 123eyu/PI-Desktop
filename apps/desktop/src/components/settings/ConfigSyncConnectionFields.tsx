import { useTranslation } from "react-i18next";
import type { ConfigSyncForm } from "../../features/settings/config-sync-form";
import { Checkbox, Field, Input, PasswordInput } from "../ui";
import { SettingsMenuSelect } from "./SettingsMenuSelect";

type Props = {
  form: ConfigSyncForm;
  configured: boolean;
  locked: boolean;
  disabled: boolean;
  onChange: <K extends keyof ConfigSyncForm>(key: K, value: ConfigSyncForm[K]) => void;
};

export function ConfigSyncConnectionFields({ form, configured, locked, disabled, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div className="settings-config-sync-form">
      <Field label={t("settings.configSync.mode")} hint={t("settings.configSync.modeHint")}>
        <SettingsMenuSelect
          fullWidth label={t("settings.configSync.mode")} value={form.mode} disabled={disabled}
          options={[
            { id: "sync", label: t("settings.configSync.modeSync") },
            { id: "backup", label: t("settings.configSync.modeBackup") },
          ]}
          onChange={(value) => { if (value === "sync" || value === "backup") onChange("mode", value); }}
        />
      </Field>
      <Field label={t("settings.configSync.endpoint")}>
        <Input value={form.endpoint} onChange={(event) => onChange("endpoint", event.target.value)}
          placeholder={t("settings.configSync.endpointPlaceholder")} aria-label={t("settings.configSync.endpoint")}
          autoComplete="url" disabled={disabled} />
      </Field>
      {(["region", "bucket", "prefix", "accessKeyId"] as const).map((key) => (
        <Field key={key} label={t(`settings.configSync.${key}`)}>
          <Input value={form[key]} onChange={(event) => onChange(key, event.target.value)}
            aria-label={t(`settings.configSync.${key}`)} autoComplete="off" disabled={disabled} />
        </Field>
      ))}
      <Field label={t("settings.configSync.addressing")} hint={t("settings.configSync.addressingHint")}>
        <SettingsMenuSelect fullWidth label={t("settings.configSync.addressing")}
          value={form.pathStyle ? "path" : "virtual"} disabled={disabled}
          options={[
            { id: "path", label: t("settings.configSync.pathStyle") },
            { id: "virtual", label: t("settings.configSync.virtualHosted") },
          ]}
          onChange={(value) => onChange("pathStyle", value === "path")} />
      </Field>
      <Field label={t("settings.configSync.secretAccessKey")}
        hint={configured ? t("settings.configSync.secretSavedHint") : undefined}>
        <PasswordInput value={form.secretAccessKey}
          onChange={(event) => onChange("secretAccessKey", event.target.value)}
          aria-label={t("settings.configSync.secretAccessKey")} autoComplete="new-password"
          showLabel={t("settings.configSync.showPassword")} hideLabel={t("settings.configSync.hidePassword")}
          disabled={disabled} />
      </Field>
      <Field label={t("settings.configSync.sessionToken")} hint={t("settings.configSync.sessionTokenHint")}>
        <PasswordInput value={form.sessionToken}
          onChange={(event) => onChange("sessionToken", event.target.value)}
          aria-label={t("settings.configSync.sessionToken")} autoComplete="new-password"
          showLabel={t("settings.configSync.showPassword")} hideLabel={t("settings.configSync.hidePassword")}
          disabled={disabled || form.clearSessionToken} />
        {configured ? <Checkbox checked={form.clearSessionToken}
          onChange={(event) => onChange("clearSessionToken", event.target.checked)}
          label={t("settings.configSync.clearSessionToken")} disabled={disabled} /> : null}
      </Field>
      <Field label={t("settings.configSync.deviceLabel")}>
        <Input value={form.deviceLabel} onChange={(event) => onChange("deviceLabel", event.target.value)}
          placeholder={t("settings.configSync.defaultDevice")} aria-label={t("settings.configSync.deviceLabel")}
          autoComplete="off" disabled={disabled} />
      </Field>
      <Field label={configured ? t("settings.configSync.backupPasswordUnlock") : t("settings.configSync.backupPassword")}
        hint={configured && !locked ? t("settings.configSync.backupPasswordOptional") : t("settings.configSync.backupPasswordHint")}>
        <PasswordInput value={form.backupPassword} onChange={(event) => onChange("backupPassword", event.target.value)}
          aria-label={t("settings.configSync.backupPassword")} autoComplete="new-password"
          showLabel={t("settings.configSync.showPassword")} hideLabel={t("settings.configSync.hidePassword")}
          disabled={disabled} />
      </Field>
      <Checkbox checked={form.automaticSync} onChange={(event) => onChange("automaticSync", event.target.checked)}
        label={t("settings.configSync.automaticSync")} disabled={disabled} />
    </div>
  );
}
