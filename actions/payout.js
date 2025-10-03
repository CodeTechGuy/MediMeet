"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

const CREDIT_VALUE = 10; // $10 per credit total
const PLATFORM_FEE_PER_CREDIT = 2; // $2 platform fee
const LAWYER_EARNINGS_PER_CREDIT = 8; // $8 to doctor

/**
 * Request payout for all remaining credits
 */
export async function requestPayout(formData) {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  try {
    const lawyer = await db.user.findUnique({
      where: {
        clerkUserId: userId,
        role: "LAWYER",
      },
    });

    if (!lawyer) {
      throw new Error("Lawyer not found");
    }

    const paypalEmail = formData.get("paypalEmail");

    if (!paypalEmail) {
      throw new Error("PayPal email is required");
    }

    // Check if doctor has any pending payout requests
    const existingPendingPayout = await db.payout.findFirst({
      where: {
        lawyerId: lawyer.id,
        status: "PROCESSING",
      },
    });

    if (existingPendingPayout) {
      throw new Error(
        "You already have a pending payout request. Please wait for it to be processed."
      );
    }

    // Get doctor's current credit balance
    const creditCount = lawyer.credits;

    if (creditCount === 0) {
      throw new Error("No credits available for payout");
    }

    if (creditCount < 1) {
      throw new Error("Minimum 1 credit required for payout");
    }

    const totalAmount = creditCount * CREDIT_VALUE;
    const platformFee = creditCount * PLATFORM_FEE_PER_CREDIT;
    const netAmount = creditCount * LAWYER_EARNINGS_PER_CREDIT;

    // Create payout request
    const payout = await db.payout.create({
      data: {
        lawyerId: lawyer.id,
        amount: totalAmount,
        credits: creditCount,
        platformFee,
        netAmount,
        paypalEmail,
        status: "PROCESSING",
      },
    });

    revalidatePath("/lawyer");
    return { success: true, payout };
  } catch (error) {
    console.error("Failed to request payout:", error);
    throw new Error("Failed to request payout: " + error.message);
  }
}

/**
 * Get doctor's payout history
 */
export async function getLawyerPayouts() {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  try {
    const lawyer = await db.user.findUnique({
      where: {
        clerkUserId: userId,
        role: "LAWYER",
      },
    });

    if (!lawyer) {
      throw new Error("Lawyer not found");
    }

    const payouts = await db.payout.findMany({
      where: {
        lawyerId: lawyer.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return { payouts };
  } catch (error) {
    throw new Error("Failed to fetch payouts: " + error.message);
  }
}

/**
 * Get doctor's earnings summary
 */
export async function getLawyerEarnings() {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  try {
    const doctor = await db.user.findUnique({
      where: {
        clerkUserId: userId,
        role: "LAWYER",
      },
    });

    if (!doctor) {
      throw new Error("Lawyer not found");
    }

    // Get all completed appointments for this doctor
    const completedAppointments = await db.appointment.findMany({
      where: {
        lawyerId: lawyer.id,
        status: "COMPLETED",
      },
    });

    // Calculate this month's completed appointments
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const thisMonthAppointments = completedAppointments.filter(
      (appointment) => new Date(appointment.createdAt) >= currentMonth
    );

    // Use doctor's actual credits from the user model
    const totalEarnings = doctor.credits * LAWYER_EARNINGS_PER_CREDIT; // $8 per credit to doctor

    // Calculate this month's earnings (2 credits per appointment * $8 per credit)
    const thisMonthEarnings =
      thisMonthAppointments.length * 2 * LAWYER_EARNINGS_PER_CREDIT;

    // Simple average per month calculation
    const averageEarningsPerMonth =
      totalEarnings > 0
        ? totalEarnings / Math.max(1, new Date().getMonth() + 1)
        : 0;

    // Get current credit balance for payout calculations
    const availableCredits = doctor.credits;
    const availablePayout = availableCredits * LAWYER_EARNINGS_PER_CREDIT;

    return {
      earnings: {
        totalEarnings,
        thisMonthEarnings,
        completedAppointments: completedAppointments.length,
        averageEarningsPerMonth,
        availableCredits,
        availablePayout,
      },
    };
  } catch (error) {
    throw new Error("Failed to fetch doctor earnings: " + error.message);
  }
}
