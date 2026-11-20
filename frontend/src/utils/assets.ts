import heroClinicImg from '/src/assets/images/hero_oral_health_clinic_1794645318329.jpg';
import guideExamImg from '/src/assets/images/guide_oral_self_exam_1794645318306.jpg';
import avatarFemaleImg from '/src/assets/images/avatar_doctor_female_1794645318724.jpg';
import avatarMaleSeniorImg from '/src/assets/images/avatar_doctor_male_senior_1794645319293.jpg';
import avatarMaleYoungImg from '/src/assets/images/avatar_doctor_male_young_1794645319224.jpg';

export const APP_IMAGES = {
  heroClinic: heroClinicImg,
  guideSelfExam: guideExamImg,
  doctors: {
    'DOC-2001': avatarFemaleImg,
    'DOC-2002': avatarMaleSeniorImg,
    'DOC-2003': avatarMaleYoungImg,
    'DOC-2004': avatarFemaleImg,
  } as Record<string, string>,
};

export function getDoctorAvatarUrl(doctorCode?: string): string | null {
  if (!doctorCode) return null;
  return APP_IMAGES.doctors[doctorCode] || null;
}
