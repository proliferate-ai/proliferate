{{- define "proliferate.name" -}}
proliferate
{{- end -}}

{{- define "proliferate.fullname" -}}
{{- printf "%s" (include "proliferate.name" .) -}}
{{- end -}}

{{- define "proliferate.labels" -}}
app.kubernetes.io/name: {{ include "proliferate.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
