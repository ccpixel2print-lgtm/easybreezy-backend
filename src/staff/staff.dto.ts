// Plain interfaces used for typing request bodies.
// Validation is done manually in the service (matching the auth module style).

export interface CreateStaffDto {
  fullName: string;
  email: string;
  phone?: string;
  role: 'EMPLOYEE' | 'SUPERVISOR';
  password: string;
}

export interface UpdateStaffDto {
  fullName?: string;
  phone?: string;
  status?: 'active' | 'inactive' | 'suspended';
}
