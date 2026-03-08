"use client";

import { Button } from "@/components/ui/button";
import { RECIPES, type Recipe } from "@/config/automations";
import { cn } from "@/lib/display/utils";

interface RecipeCardsProps {
	onSelect: (recipe: Recipe) => void;
	disabled?: boolean;
}

export function RecipeCards({ onSelect, disabled }: RecipeCardsProps) {
	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
			{RECIPES.map((recipe) => {
				const { Icon, ...recipeData } = recipe;
				return (
					<Button
						key={recipe.name}
						type="button"
						variant="outline"
						disabled={disabled}
						onClick={() => onSelect(recipeData)}
						className={cn(
							"group flex flex-col items-start gap-3 p-5 rounded-lg border-border bg-card text-left h-auto",
							"hover:border-primary/50 hover:bg-muted/30",
							"disabled:opacity-50 disabled:cursor-not-allowed",
						)}
					>
						<div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
							<Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
						</div>
						<div>
							<h3 className="font-medium text-foreground group-hover:text-primary transition-colors">
								{recipe.name}
							</h3>
							<p className="text-sm text-muted-foreground mt-1">{recipe.description}</p>
						</div>
					</Button>
				);
			})}
		</div>
	);
}
