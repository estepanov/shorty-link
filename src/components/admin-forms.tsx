import { useForm } from "@tanstack/react-form";
import {
	type FormHTMLAttributes,
	type ReactNode,
	useEffect,
	useId,
	useState,
} from "react";

import {
	Button,
	FieldLabel,
	Input,
	Notice,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Switch,
	TextArea,
} from "@/components/ui";
import {
	FieldDescription as FormFieldDescription,
	FieldLegend as FormFieldLegend,
	FieldSet as FormFieldSet,
} from "@/components/ui/field";
import type { AdminDomain, AdminLink, AssignableRole } from "@/lib/admin-types";
import {
	type ManagedDomainRootBehavior,
	type ManagedDomainUnknownSlugBehavior,
	managedDomainRootBehaviorOptions,
	managedDomainUnknownSlugBehaviorOptions,
	normalizeManagedDomainRootBehavior,
	normalizeManagedDomainUnknownSlugBehavior,
} from "@/lib/domain-routing";
import { getTreaty, unwrap } from "@/lib/eden";
import type { createTranslator } from "@/lib/i18n";
import {
	normalizeRedirectStatusCode,
	redirectStatusOptions,
} from "@/lib/redirect-status";
import { cn } from "@/lib/utils";

const DEFAULT_HOSTNAME_SELECT_VALUE = "__default__";

export function AdminFormRoot({
	className,
	...props
}: FormHTMLAttributes<HTMLFormElement>) {
	return (
		<form
			className={cn(
				"mt-7 flex flex-col gap-5 rounded-xl border border-border/80 bg-card/80 p-4 shadow-[0_18px_60px_-42px_color-mix(in_oklab,var(--foreground)_70%,transparent)] sm:p-5",
				className,
			)}
			{...props}
		/>
	);
}

export function FormGrid({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("grid gap-4 md:grid-cols-2", className)}>{children}</div>
	);
}

export function FormSection({
	children,
	description,
	title,
}: {
	children: ReactNode;
	description?: ReactNode;
	title: ReactNode;
}) {
	return (
		<FormFieldSet className="rounded-lg border border-border/70 bg-muted/25 p-4">
			<div className="flex flex-col gap-1.5">
				<FormFieldLegend className="font-display text-xl leading-tight tracking-tight">
					{title}
				</FormFieldLegend>
				{description ? (
					<FormFieldDescription className="max-w-2xl leading-relaxed">
						{description}
					</FormFieldDescription>
				) : null}
			</div>
			<div className="grid gap-4">{children}</div>
		</FormFieldSet>
	);
}

type ToggleTone = "default" | "green" | "amber" | "blue";

const toggleLabelStyles: Record<
	ToggleTone,
	{ checked: string; unchecked: string }
> = {
	default: {
		checked: "border-accent/60 text-foreground",
		unchecked: "border-border/80 text-muted-foreground",
	},
	green: {
		checked: "border-success/60 text-foreground",
		unchecked: "border-border/80 text-muted-foreground",
	},
	amber: {
		checked: "border-accent/60 text-foreground",
		unchecked: "border-border/80 text-muted-foreground",
	},
	blue: {
		checked: "border-info/60 text-foreground",
		unchecked: "border-border/80 text-muted-foreground",
	},
} as const;

const toggleSwitchStyles: Record<ToggleTone, string> = {
	default: "data-[state=checked]:bg-accent",
	green: "data-[state=checked]:bg-success",
	amber: "data-[state=checked]:bg-accent",
	blue: "data-[state=checked]:bg-info",
};

export function ToggleTile({
	checked,
	children,
	disabled = false,
	onCheckedChange,
	tone = "default",
}: {
	checked: boolean;
	children: ReactNode;
	disabled?: boolean;
	onCheckedChange: (checked: boolean) => void;
	tone?: ToggleTone;
}) {
	const id = useId();

	return (
		<div
			className={cn(
				"group flex min-h-14 items-center justify-between gap-4 rounded-lg border bg-background/65 p-3 text-sm font-medium shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_4%,transparent)] transition-colors",
				disabled
					? "cursor-not-allowed opacity-60"
					: "cursor-pointer hover:border-foreground/25",
				checked
					? toggleLabelStyles[tone].checked
					: toggleLabelStyles[tone].unchecked,
			)}
			data-checked={checked}
			data-disabled={disabled}
		>
			<label className="cursor-inherit" htmlFor={id}>
				{children}
			</label>
			<Switch
				checked={checked}
				className={toggleSwitchStyles[tone]}
				disabled={disabled}
				id={id}
				onCheckedChange={onCheckedChange}
			/>
		</div>
	);
}

export function FormFooter({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-col-reverse gap-3 border-t border-border/70 pt-5 sm:flex-row sm:justify-end">
			{children}
		</div>
	);
}

export type CreatedInvite = {
	id: string;
	inviteUrl: string;
	token: string;
};

export function LinkForm({
	domains,
	initialLink,
	onSaved,
	t,
}: {
	domains: AdminDomain[];
	initialLink?: AdminLink | null;
	onSaved: () => Promise<void> | void;
	t: ReturnType<typeof createTranslator>;
}) {
	const [error, setError] = useState<string | null>(null);
	const selectedHostname =
		initialLink?.hostname === "__default__"
			? ""
			: (initialLink?.hostname ?? "");
	const hasSelectedManagedHostname = domains.some(
		(domain) => domain.hostname === selectedHostname,
	);
	const form = useForm({
		defaultValues: {
			hostname: selectedHostname,
			isActive: initialLink?.isActive ?? true,
			notes: initialLink?.notes ?? "",
			preserveQueryParams: initialLink?.preserveQueryParams ?? false,
			slug: initialLink?.slug ?? "",
			statusCode: normalizeRedirectStatusCode(initialLink?.statusCode),
			targetUrl: initialLink?.targetUrl ?? "",
			title: initialLink?.title ?? "",
		},
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const api = getTreaty();
				if (initialLink) {
					await unwrap(
						await api.admin.links({ id: initialLink.id }).patch(value),
					);
				} else {
					await unwrap(await api.admin.links.post(value));
				}
				await onSaved();
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		},
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: form.reset is stable; re-seed defaults only when the edited link identity changes.
	useEffect(() => {
		form.reset({
			hostname:
				initialLink?.hostname === "__default__"
					? ""
					: (initialLink?.hostname ?? ""),
			isActive: initialLink?.isActive ?? true,
			notes: initialLink?.notes ?? "",
			preserveQueryParams: initialLink?.preserveQueryParams ?? false,
			slug: initialLink?.slug ?? "",
			statusCode: normalizeRedirectStatusCode(initialLink?.statusCode),
			targetUrl: initialLink?.targetUrl ?? "",
			title: initialLink?.title ?? "",
		});
	}, [initialLink?.id]);

	return (
		<AdminFormRoot
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<FormSection
				description={t("links.redirectTargetDescription")}
				title={t("links.redirectTarget")}
			>
				<form.Field name="targetUrl">
					{(field) => (
						<FieldLabel>
							{t("forms.destination")}
							<Input
								onChange={(event) => field.handleChange(event.target.value)}
								placeholder={t("forms.placeholderDestination")}
								required
								value={field.state.value}
							/>
						</FieldLabel>
					)}
				</form.Field>
				<FormGrid>
					<form.Field name="hostname">
						{(field) => (
							<FieldLabel>
								{t("forms.hostname")}
								<Select
									onValueChange={(value) =>
										field.handleChange(
											value === DEFAULT_HOSTNAME_SELECT_VALUE ? "" : value,
										)
									}
									value={field.state.value || DEFAULT_HOSTNAME_SELECT_VALUE}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={DEFAULT_HOSTNAME_SELECT_VALUE}>
											{t("domains.default")}
										</SelectItem>
										{selectedHostname && !hasSelectedManagedHostname ? (
											<SelectItem value={selectedHostname}>
												{selectedHostname} ({t("domains.current")})
											</SelectItem>
										) : null}
										{domains.map((domain) => (
											<SelectItem key={domain.id} value={domain.hostname}>
												{domain.hostname}
												{domain.label ? ` - ${domain.label}` : ""}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</FieldLabel>
						)}
					</form.Field>
					<form.Field name="statusCode">
						{(field) => (
							<FieldLabel>
								{t("forms.statusCode")}
								<Select
									onValueChange={(val: string) =>
										field.handleChange(normalizeRedirectStatusCode(Number(val)))
									}
									value={String(field.state.value)}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{redirectStatusOptions.map((option) => (
											<SelectItem key={option.code} value={String(option.code)}>
												{t(option.labelKey)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</FieldLabel>
						)}
					</form.Field>
				</FormGrid>
				<form.Field name="slug">
					{(field) => (
						<FieldLabel>
							{t("forms.slug")}
							<Input
								onChange={(event) => field.handleChange(event.target.value)}
								placeholder={t("forms.placeholderSlug")}
								value={field.state.value}
							/>
						</FieldLabel>
					)}
				</form.Field>
			</FormSection>
			<FormSection
				description={t("links.metadataDescription")}
				title={t("links.metadata")}
			>
				<form.Field name="title">
					{(field) => (
						<FieldLabel>
							{t("forms.title")}
							<Input
								onChange={(event) => field.handleChange(event.target.value)}
								value={field.state.value}
							/>
						</FieldLabel>
					)}
				</form.Field>
				<form.Field name="notes">
					{(field) => (
						<FieldLabel>
							{t("forms.notes")}
							<TextArea
								onChange={(event) => field.handleChange(event.target.value)}
								value={field.state.value}
							/>
						</FieldLabel>
					)}
				</form.Field>
			</FormSection>
			<FormSection
				description={t("links.behaviorDescription")}
				title={t("links.behavior")}
			>
				<FormGrid className="sm:grid-cols-2">
					<form.Field name="preserveQueryParams">
						{(field) => (
							<ToggleTile
								checked={field.state.value}
								onCheckedChange={field.handleChange}
								tone="blue"
							>
								{t("forms.preserveQuery")}
							</ToggleTile>
						)}
					</form.Field>
					<form.Field name="isActive">
						{(field) => (
							<ToggleTile
								checked={field.state.value}
								onCheckedChange={field.handleChange}
								tone="green"
							>
								{t("forms.active")}
							</ToggleTile>
						)}
					</form.Field>
				</FormGrid>
			</FormSection>
			{error ? <Notice tone="error">{t(error)}</Notice> : null}
			<FormFooter>
				<Button className="sm:min-w-32" type="submit">
					{initialLink ? t("forms.update") : t("forms.create")}
				</Button>
			</FormFooter>
		</AdminFormRoot>
	);
}

export function DomainForm({
	initialDomain,
	onSaved,
	t,
}: {
	initialDomain?: AdminDomain | null;
	onSaved: () => Promise<void> | void;
	t: ReturnType<typeof createTranslator>;
}) {
	type DomainFormValues = {
		hostname: string;
		isActive: boolean;
		isPrimary: boolean;
		label: string;
		rootBehavior: ManagedDomainRootBehavior;
		rootRedirectStatusCode: (typeof redirectStatusOptions)[number]["code"];
		rootRedirectTargetUrl: string;
		unknownSlugBehavior: ManagedDomainUnknownSlugBehavior;
		unknownSlugRedirectStatusCode: (typeof redirectStatusOptions)[number]["code"];
		unknownSlugRedirectTargetUrl: string;
	};

	function buildDomainFormValues(
		domain?: AdminDomain | null,
	): DomainFormValues {
		return {
			hostname: domain?.hostname ?? "",
			isActive: domain?.isActive ?? true,
			isPrimary: domain?.isPrimary ?? false,
			label: domain?.label ?? "",
			rootBehavior: normalizeManagedDomainRootBehavior(domain?.rootBehavior),
			rootRedirectStatusCode: normalizeRedirectStatusCode(
				domain?.rootRedirectStatusCode ?? undefined,
			),
			rootRedirectTargetUrl: domain?.rootRedirectTargetUrl ?? "",
			unknownSlugBehavior: normalizeManagedDomainUnknownSlugBehavior(
				domain?.unknownSlugBehavior,
			),
			unknownSlugRedirectStatusCode: normalizeRedirectStatusCode(
				domain?.unknownSlugRedirectStatusCode ?? undefined,
			),
			unknownSlugRedirectTargetUrl: domain?.unknownSlugRedirectTargetUrl ?? "",
		};
	}

	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: buildDomainFormValues(initialDomain),
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const api = getTreaty();
				if (initialDomain) {
					await unwrap(
						await api.admin.domains({ id: initialDomain.id }).patch(value),
					);
				} else {
					await unwrap(await api.admin.domains.post(value));
				}
				await onSaved();
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		},
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: form.reset is stable; re-seed defaults only when the edited domain identity changes.
	useEffect(() => {
		form.reset(buildDomainFormValues(initialDomain));
	}, [initialDomain?.id]);

	return (
		<AdminFormRoot
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<FormGrid>
				<form.Field name="hostname">
					{(field) => (
						<FieldLabel>
							{t("forms.hostname")}
							<Input
								onChange={(event) => field.handleChange(event.target.value)}
								placeholder={t("forms.placeholderHostname")}
								required
								value={field.state.value}
							/>
						</FieldLabel>
					)}
				</form.Field>
				<form.Field name="label">
					{(field) => (
						<FieldLabel>
							{t("forms.label")}
							<Input
								onChange={(event) => field.handleChange(event.target.value)}
								value={field.state.value}
							/>
						</FieldLabel>
					)}
				</form.Field>
			</FormGrid>
			<FormSection
				description={t("domains.rootBehaviorHelp")}
				title={t("domains.rootBehavior")}
			>
				<form.Field name="rootBehavior">
					{(field) => (
						<div className="grid gap-4">
							<FieldLabel>
								{t("domains.rootBehavior")}
								<Select
									onValueChange={(val) =>
										field.handleChange(val as ManagedDomainRootBehavior)
									}
									value={field.state.value}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{managedDomainRootBehaviorOptions.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{t(option.labelKey)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</FieldLabel>
							{field.state.value === "redirect" ? (
								<FormGrid>
									<form.Field name="rootRedirectStatusCode">
										{(statusField) => (
											<FieldLabel>
												{t("forms.statusCode")}
												<Select
													onValueChange={(val: string) =>
														statusField.handleChange(
															normalizeRedirectStatusCode(Number(val)),
														)
													}
													value={String(statusField.state.value)}
												>
													<SelectTrigger>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{redirectStatusOptions.map((option) => (
															<SelectItem
																key={option.code}
																value={String(option.code)}
															>
																{t(option.labelKey)}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</FieldLabel>
										)}
									</form.Field>
									<form.Field name="rootRedirectTargetUrl">
										{(targetField) => (
											<FieldLabel>
												{t("forms.destination")}
												<Input
													onChange={(event) =>
														targetField.handleChange(event.target.value)
													}
													placeholder={t("forms.placeholderDestination")}
													required
													value={targetField.state.value}
												/>
											</FieldLabel>
										)}
									</form.Field>
								</FormGrid>
							) : null}
						</div>
					)}
				</form.Field>
			</FormSection>
			<FormSection
				description={t("domains.unknownSlugBehaviorHelp")}
				title={t("domains.unknownSlugBehavior")}
			>
				<form.Field name="unknownSlugBehavior">
					{(field) => (
						<div className="grid gap-4">
							<FieldLabel>
								{t("domains.unknownSlugBehavior")}
								<Select
									onValueChange={(val) =>
										field.handleChange(val as ManagedDomainUnknownSlugBehavior)
									}
									value={field.state.value}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{managedDomainUnknownSlugBehaviorOptions.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{t(option.labelKey)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</FieldLabel>
							{field.state.value === "redirect" ? (
								<FormGrid>
									<form.Field name="unknownSlugRedirectStatusCode">
										{(statusField) => (
											<FieldLabel>
												{t("forms.statusCode")}
												<Select
													onValueChange={(val: string) =>
														statusField.handleChange(
															normalizeRedirectStatusCode(Number(val)),
														)
													}
													value={String(statusField.state.value)}
												>
													<SelectTrigger>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{redirectStatusOptions.map((option) => (
															<SelectItem
																key={option.code}
																value={String(option.code)}
															>
																{t(option.labelKey)}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</FieldLabel>
										)}
									</form.Field>
									<form.Field name="unknownSlugRedirectTargetUrl">
										{(targetField) => (
											<FieldLabel>
												{t("forms.destination")}
												<Input
													onChange={(event) =>
														targetField.handleChange(event.target.value)
													}
													placeholder={t("forms.placeholderDestination")}
													required
													value={targetField.state.value}
												/>
											</FieldLabel>
										)}
									</form.Field>
								</FormGrid>
							) : null}
						</div>
					)}
				</form.Field>
			</FormSection>
			<FormGrid className="sm:grid-cols-2">
				<form.Field name="isPrimary">
					{(field) => (
						<ToggleTile
							checked={field.state.value}
							onCheckedChange={field.handleChange}
							tone="amber"
						>
							{t("forms.primary")}
						</ToggleTile>
					)}
				</form.Field>
				<form.Field name="isActive">
					{(field) => (
						<ToggleTile
							checked={field.state.value}
							onCheckedChange={field.handleChange}
							tone="green"
						>
							{t("forms.active")}
						</ToggleTile>
					)}
				</form.Field>
			</FormGrid>
			{error ? <Notice tone="error">{t(error)}</Notice> : null}
			<FormFooter>
				<Button className="sm:min-w-32" type="submit">
					{initialDomain ? t("forms.update") : t("forms.create")}
				</Button>
			</FormFooter>
		</AdminFormRoot>
	);
}

export function InviteForm({
	onSaved,
	roles,
	t,
}: {
	onSaved: (invite: CreatedInvite) => Promise<void> | void;
	roles: AssignableRole[];
	t: ReturnType<typeof createTranslator>;
}) {
	const [error, setError] = useState<string | null>(null);
	const defaultRoleId =
		roles.find((role) => role.id === "system_admin")?.id ?? roles[0]?.id ?? "";
	const form = useForm({
		defaultValues: {
			email: "",
			expiresInDays: 7,
			roleId: defaultRoleId,
		},
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const api = getTreaty();
				const invite = await unwrap<CreatedInvite>(
					await api.admin.invites.post(value),
				);
				form.reset();
				await onSaved(invite);
			} catch (nextError) {
				setError(
					nextError instanceof Error ? nextError.message : "errors.unknown",
				);
			}
		},
	});

	return (
		<AdminFormRoot
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<FormSection
				description={t("invites.recipientDescription")}
				title={t("invites.recipient")}
			>
				<form.Field name="email">
					{(field) => (
						<FieldLabel>
							{t("forms.email")}
							<Input
								onChange={(event) => field.handleChange(event.target.value)}
								required
								type="email"
								value={field.state.value}
							/>
						</FieldLabel>
					)}
				</form.Field>
			</FormSection>
			<FormSection
				description={t("invites.accessDescription")}
				title={t("invites.access")}
			>
				<FormGrid>
					<form.Field name="roleId">
						{(field) => (
							<FieldLabel>
								{t("users.role")}
								<Select
									onValueChange={field.handleChange}
									value={field.state.value}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{roles.map((role) => (
											<SelectItem key={role.id} value={role.id}>
												{role.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</FieldLabel>
						)}
					</form.Field>
					<form.Field name="expiresInDays">
						{(field) => (
							<FieldLabel>
								{t("forms.expiresInDays")}
								<Input
									max={30}
									min={1}
									onChange={(event) =>
										field.handleChange(Number(event.target.value))
									}
									type="number"
									value={field.state.value}
								/>
							</FieldLabel>
						)}
					</form.Field>
				</FormGrid>
			</FormSection>
			{error ? <Notice tone="error">{t(error)}</Notice> : null}
			<FormFooter>
				<Button className="sm:min-w-32" type="submit">
					{t("forms.create")}
				</Button>
			</FormFooter>
		</AdminFormRoot>
	);
}
