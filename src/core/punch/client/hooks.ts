"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useElysia } from "@/frontend/lib/eden";

const unwrap = (result: unknown) => (result as { response: unknown }).response;

export const useDashboard = () => {
    const client = useElysia().punch;
    return useQuery({
        ...(client.dashboard.get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["punch", "dashboard"],
        placeholderData: keepPreviousData,
        select: unwrap,
    });
};
export const useCampaigns = () => {
    const client = useElysia().punch;
    return useQuery({
        ...(client.campaigns.get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["punch", "campaigns"],
        select: unwrap,
    });
};
export const useCampaign = (id: string) => {
    const client = useElysia().punch;
    return useQuery({
        ...(client.campaigns({ id }).get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["punch", "campaigns", id],
        select: unwrap,
    });
};
export const useCrawls = () => {
    const client = useElysia().punch;
    return useQuery({
        ...(client.crawls.get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["punch", "crawls"],
        select: unwrap,
    });
};
export const useCrawl = (id: string) => {
    const client = useElysia().punch;
    return useQuery({
        ...(client.crawls({ id }).get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["punch", "crawls", id],
        select: unwrap,
    });
};
export const useVouchers = () => {
    const client = useElysia().punch;
    return useQuery({
        ...(client.vouchers.get.queryOptions() as unknown as Record<
            string,
            unknown
        >),
        queryKey: ["punch", "vouchers"],
        select: unwrap,
    });
};
