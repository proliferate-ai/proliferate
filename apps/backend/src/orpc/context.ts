export interface BaseContext {
	request: Request;
}

export interface AuthContext extends BaseContext {
	user: {
		id: string;
		email: string;
		name: string;
	};
	session: {
		id: string;
		activeOrganizationId?: string | null;
	};
}

export interface OrgContext extends AuthContext {
	orgId: string;
}
