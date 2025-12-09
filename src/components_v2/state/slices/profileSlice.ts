// src/components_v2/state/slices/profileSlice.ts
import type { ProfileData } from '@/types/planner';

export type ProfileSlice = {
  profile: ProfileData;
  setProfile: (patch: Partial<ProfileData>) => void;
  resetProfile: () => void;
};

// valori di default (campi vuoti)
export const defaultProfile: ProfileData = {
  customerStatus: 'new',
  customerType: 'private',
  legalForm: '',
  source: '',

  contactSalutation: null,
  contactFirstName: '',
  contactLastName: '',
  contactMobile: '',
  contactEmail: '',

  billingStreet: '',
  billingStreetNo: '',
  billingCity: '',
  billingZip: '',

  buildingStreet: '',
  buildingStreetNo: '',
  buildingCity: '',
  buildingZip: '',

  businessName: '',
  businessStreet: '',
  businessStreetNo: '',
  businessCity: '',
  businessZip: '',
  businessPhone: '',
  businessEmail: '',
  businessWebsite: '',

  leadLabel: '',
};

export const createProfileSlice = (set: any, get: any, api: any): ProfileSlice => ({
  profile: defaultProfile,

  setProfile: (patch) =>
    set((state: any) => ({
      profile: {
        ...(state.profile || defaultProfile),
        ...patch,
      },
    })),

  resetProfile: () =>
    set(() => ({
      profile: defaultProfile,
    })),
});
